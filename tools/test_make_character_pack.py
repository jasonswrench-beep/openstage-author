# SPDX-License-Identifier: Apache-2.0
"""Tests for the tool that makes a character pack from a folder of pictures."""
import json
import pathlib
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import charpack  # noqa: E402
import make_character_pack as m  # noqa: E402
import pngio  # noqa: E402

W, H = 120, 200


def figure(x0, y0, x1, y1, colour=(200, 80, 60)):
    """A clear picture with one solid block in it, standing for a person."""
    px = bytearray(W * H * 4)
    for y in range(y0, y1):
        for x in range(x0, x1):
            px[(y * W + x) * 4:(y * W + x) * 4 + 4] = bytes((*colour, 255))
    return pngio.write_png(W, H, px)


class Making(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="openstage-make-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        raw = self.dir / "raw" / "Ann"
        raw.mkdir(parents=True)
        (raw / "_aaa111_x_cover.png").write_bytes(figure(40, 20, 80, 180))
        (raw / "_bbb222_y_cover.png").write_bytes(figure(30, 20, 100, 180))     # an arm held out to the right
        (raw / "_ccc333_z_cover.png").write_bytes(figure(40, 10, 80, 180))      # a hand above the head
        (raw / "_ccc333_z_cover (1).png").write_bytes(figure(40, 10, 80, 180))  # the same picture saved twice
        self.source = {
            "id": "made-people", "title": "Made people", "version": "1.0.0",
            "credit": {"creator": "A. Maker", "licence": "Free to use in OpenStage courses", "url": "https://example.org"},
            "folder": "raw", "poseHeight": 100, "headSize": 32,
            "people": [{
                "id": "ann", "name": "Ann", "voice": "female", "alt": "Ann, a woman in red.", "folder": "Ann", "default": "neutral",
                "poses": [
                    {"id": "neutral", "file": "_aaa", "label": "Standing", "alt": "Ann standing."},
                    {"id": "present-right", "file": "_bbb", "label": "Presenting", "alt": "Ann holding out an arm."},
                    {"id": "welcome", "file": "_ccc", "label": "Waving", "alt": "Ann waving."},
                ],
            }],
        }
        self.path = self.dir / "pack-source.json"
        self.write()
        self.out = self.dir / "out"

    def write(self):
        self.path.write_text(json.dumps(self.source), encoding="utf-8")

    def make(self, **kw):
        lines = []
        out = m.make(self.path, self.out, say=lines.append, **kw)
        return out, lines

    def test_a_good_pack_is_made_and_passes_the_check(self):
        out, lines = self.make()
        manifest = charpack.check_pack(out)
        self.assertEqual([p["id"] for p in manifest["people"]], ["ann"])
        self.assertEqual([x["file"] for x in manifest["people"][0]["poses"]], ["ann/neutral.png", "ann/present-right.png", "ann/welcome.png"])
        self.assertNotIn("folder", manifest["people"][0])
        self.assertTrue(any("is good" in line for line in lines))
        self.assertEqual(json.loads((out / "pack.json").read_text(encoding="utf-8"))["people"][0]["head"], "ann/head.png")

    def test_every_pose_of_a_person_has_the_same_size_and_the_frame_holds_them_all(self):
        out, _ = self.make()
        sizes = {pngio.size_of((out / "ann" / f"{pose}.png").read_bytes()) for pose in ("neutral", "present-right", "welcome")}
        self.assertEqual(len(sizes), 1)
        (w, h), = sizes
        self.assertEqual(h, 100)
        # The widest pose (70 wide) and the tallest (170) with a margin each side set the frame: 82 by 182, made 100 tall.
        self.assertEqual(w, round(82 * 100 / 182))

    def test_the_head_picture_is_square_and_shows_the_top_of_the_figure(self):
        out, _ = self.make()
        w, h, px = pngio.read_png((out / "ann" / "head.png").read_bytes())
        self.assertEqual((w, h), (32, 32))
        top_row = px[(2 * 32) * 4:(3 * 32) * 4]
        self.assertTrue(any(top_row[3::4]), "the head is near the top of the head picture")

    def test_a_picture_saved_twice_counts_as_one_but_two_different_ones_do_not(self):
        self.make()
        (self.dir / "raw" / "Ann" / "_ccc333_z_cover (1).png").write_bytes(figure(41, 10, 80, 180))
        with self.assertRaises(m.MakeError) as ctx:
            self.make()
        self.assertIn("more than one picture starts with", str(ctx.exception))

    def test_a_pose_with_no_picture_is_named(self):
        self.source["people"][0]["poses"][0]["file"] = "_zzz"
        self.write()
        with self.assertRaises(m.MakeError) as ctx:
            self.make()
        self.assertIn("no picture", str(ctx.exception))
        self.assertIn("neutral", str(ctx.exception))

    def test_words_that_are_wrong_are_found_before_any_picture_is_made(self):
        self.source["people"][0]["poses"][1]["alt"] = ""
        self.write()
        with self.assertRaises(m.MakeError) as ctx:
            self.make()
        self.assertIn("\"alt\" is needed", str(ctx.exception))
        self.assertFalse((self.out / "ann").exists())

    def test_the_head_needs_a_pose_to_be_cut_from_or_a_box(self):
        self.source["people"][0]["default"] = "sitting"
        self.write()
        with self.assertRaises(m.MakeError) as ctx:
            self.make()
        self.assertIn("\"sitting\"", str(ctx.exception))
        self.source["people"][0]["headBox"] = [30, 10, 60]
        self.write()
        self.make()
        self.assertEqual(pngio.size_of((self.out / "ann" / "head.png").read_bytes()), (32, 32))

    def test_pictures_of_different_sizes_cannot_share_a_frame(self):
        (self.dir / "raw" / "Ann" / "_bbb222_y_cover.png").write_bytes(pngio.write_png(10, 10, bytearray(400)))
        with self.assertRaises(m.MakeError) as ctx:
            self.make()
        self.assertIn("not all the same size", str(ctx.exception))

    def test_one_person_can_be_made_alone_and_then_no_pack_json_is_written(self):
        out, lines = self.make(only="ann")
        self.assertTrue((out / "ann" / "head.png").is_file())
        self.assertFalse((out / "pack.json").exists())
        with self.assertRaises(m.MakeError):
            self.make(only="nobody")

    def test_working_on_several_pictures_at_once_gives_the_same_pack(self):
        serial, _ = self.make()
        first = {p.name: p.read_bytes() for p in (serial / "ann").iterdir()}
        shutil.rmtree(self.out)
        parallel, _ = self.make(jobs=2)
        second = {p.name: p.read_bytes() for p in (parallel / "ann").iterdir()}
        self.assertEqual(first, second)

    def test_the_command_line_says_what_went_wrong_and_returns_one(self):
        self.assertEqual(m.main([str(self.path), "--out", str(self.out), "--jobs", "0"]), 0)
        self.source["people"][0]["id"] = "Bad Id"
        self.write()
        self.assertEqual(m.main([str(self.path), "--out", str(self.out), "--jobs", "0"]), 1)


if __name__ == "__main__":
    unittest.main()
