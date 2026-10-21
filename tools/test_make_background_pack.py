# SPDX-License-Identifier: Apache-2.0
"""Tests for the tool that makes a pack of backgrounds. They need FFmpeg (it writes the WebP pictures), and are skipped on a computer without it."""
import json
import pathlib
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import charpack  # noqa: E402
import make_background_pack as m  # noqa: E402
import pngio  # noqa: E402

FFMPEG = m.find_ffmpeg()


def picture(w, h, shade):
    return pngio.write_png(w, h, bytearray(bytes((shade, 120, 200, 255)) * (w * h)))


def source(**over):
    base = {
        "id": "test-rooms", "title": "Test rooms", "version": "1.0.0", "description": "Two rooms.",
        "credit": {"creator": "A. Maker", "creatorUrl": "", "licence": "Free to use", "url": "https://example.org/packs"},
        "size": [64, 36], "webpQuality": 80,
        "backgrounds": [
            {"id": "office-1", "name": "Office", "group": "Offices", "alt": "An empty office.", "source": "first-picture"},
            {"id": "hall-1", "name": "Hall", "alt": "A corridor.", "source": "second-picture.png"},
        ],
    }
    base.update(over)
    return base


class Temp(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="openstage-bgpack-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.raw = self.dir / "raw"
        self.raw.mkdir()
        (self.raw / "first-picture.png").write_bytes(picture(128, 72, 60))
        (self.raw / "second-picture.png").write_bytes(picture(128, 72, 200))

    def write(self, data):
        path = self.dir / "source.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        return path


class TheSource(Temp):
    def test_a_source_that_is_not_a_pack_description_is_refused(self):
        path = self.dir / "x.json"
        path.write_text("[1, 2]", encoding="utf-8")
        with self.assertRaises(m.MakeError):
            m.read_source(path)
        path.write_text("not json", encoding="utf-8")
        with self.assertRaises(m.MakeError):
            m.read_source(path)


@unittest.skipUnless(FFMPEG, "FFmpeg is not on this computer")
class Making(Temp):
    def test_the_pictures_are_made_the_size_asked_for_as_webp_and_the_pack_is_good(self):
        out = m.make(self.write(source()), out=self.dir / "out", raw=self.raw, say=lambda *_: None)
        made = charpack.check_pack(out)
        self.assertEqual(made["packVersion"], 2)
        self.assertEqual([b["file"] for b in made["backgrounds"]], ["backgrounds/office-1.webp", "backgrounds/hall-1.webp"])
        self.assertEqual(made["backgrounds"][0]["group"], "Offices")
        for b in made["backgrounds"]:
            data = (out / b["file"]).read_bytes()
            self.assertEqual(charpack.picture_size(b["file"], data), (64, 36))
        shown = json.loads((out / "pack.json").read_text(encoding="utf-8"))
        self.assertNotIn("source", shown["backgrounds"][0])
        self.assertNotIn("size", shown)
        self.assertNotIn("webpQuality", shown)

    def test_a_picture_that_is_not_there_is_named_before_anything_is_made(self):
        data = source()
        data["backgrounds"][1]["source"] = "missing-picture"
        with self.assertRaises(m.MakeError) as ctx:
            m.make(self.write(data), out=self.dir / "out", raw=self.raw, say=lambda *_: None)
        self.assertIn("missing-picture.png", str(ctx.exception))
        self.assertFalse((self.dir / "out").exists())

    def test_a_mistake_in_the_words_is_named_before_anything_is_made(self):
        data = source()
        data["backgrounds"][0]["alt"] = ""
        with self.assertRaises(m.MakeError) as ctx:
            m.make(self.write(data), out=self.dir / "out", raw=self.raw, say=lambda *_: None)
        self.assertIn("alt", str(ctx.exception))
        self.assertFalse((self.dir / "out").exists())

    def test_making_again_leaves_no_old_picture_behind(self):
        out = self.dir / "out"
        m.make(self.write(source()), out=out, raw=self.raw, say=lambda *_: None)
        data = source()
        data["backgrounds"] = data["backgrounds"][:1]
        m.make(self.write(data), out=out, raw=self.raw, say=lambda *_: None)
        self.assertEqual(sorted(p.name for p in (out / "backgrounds").glob("*.webp")), ["office-1.webp"])

    def test_the_size_and_quality_are_checked(self):
        for over in ({"size": [100]}, {"size": [8, 8]}, {"size": "big"}, {"webpQuality": 0}, {"webpQuality": "high"}):
            with self.subTest(over=over):
                with self.assertRaises(m.MakeError):
                    m.make(self.write(source(**over)), out=self.dir / "out", raw=self.raw, say=lambda *_: None)


if __name__ == "__main__":
    unittest.main(verbosity=1)
