# SPDX-License-Identifier: Apache-2.0
"""Tests for getting packs ready for the website: the zip, its checksum, and the page that lists the packs."""
import contextlib
import hashlib
import io
import pathlib
import re
import sys
import unittest
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import charpack as c  # noqa: E402
import pack_for_website as site  # noqa: E402
from test_charpack import Temp, manifest, picture, write_pack  # noqa: E402


def background_manifest(**over):
    base = {
        "packVersion": 2, "id": "test-rooms", "title": "Test rooms", "version": "1.0.0", "description": "Six rooms for tests.",
        "credit": {"creator": "B. Maker", "creatorUrl": "", "licence": "Public domain.", "url": "https://example.org/rooms"},
        "backgrounds": [
            {"id": f"room-{n}", "name": f"Room {n}", "group": "Offices" if n < 4 else "Halls", "alt": f"Room number {n}, plain walls and a table.", "file": f"backgrounds/room-{n}.png"}
            for n in range(1, 7)
        ],
    }
    base.update(over)
    return base


class Site(Temp):
    def setUp(self):
        super().setUp()
        self.out = self.dir / "site"

    def people(self, **over):
        return write_pack(self.dir / f"people-{len(list(self.dir.iterdir()))}", manifest(**over))

    def rooms(self, **over):
        return write_pack(self.dir / f"rooms-{len(list(self.dir.iterdir()))}", background_manifest(**over))


class TheZip(Site):
    def test_a_good_pack_makes_a_zip_the_editor_takes_and_a_checksum_that_matches(self):
        done = site.make_zip(self.people(), self.out, self.bundled)
        self.assertEqual(done["file"], "test-people-1.0.0.zip")
        zip_path = self.out / done["file"]
        self.assertTrue(zip_path.is_file())
        digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
        self.assertEqual(done["sha256"], digest)
        self.assertEqual((self.out / "test-people-1.0.0.zip.sha256.txt").read_text(encoding="utf-8"), f"{digest}  test-people-1.0.0.zip\n")
        with zipfile.ZipFile(zip_path) as z:
            names = z.namelist()
        self.assertIn("test-people/pack.json", names)
        self.assertIn("test-people/ann/head.png", names)
        self.assertTrue(all(n.startswith("test-people/") for n in names), "everything sits in one folder named for the pack")
        answer = c.install_zip(zip_path, self.bundled, self.yours)
        self.assertTrue(answer["ok"])
        self.assertEqual(answer["id"], "test-people")

    def test_the_same_pack_always_makes_the_same_bytes(self):
        folder = self.people()
        first = site.make_zip(folder, self.out, self.bundled)
        second = site.make_zip(folder, self.dir / "elsewhere", self.bundled)
        self.assertEqual(first["sha256"], second["sha256"])

    def test_only_a_pack_s_own_files_go_in_and_the_rest_is_named_as_left_out(self):
        folder = self.people()
        (folder / "README.txt").write_text("About this pack.", encoding="utf-8")
        (folder / "Thumbs.db").write_bytes(b"junk")
        (folder / "ann" / "unused.png").write_bytes(picture())
        (folder / "deeper").mkdir()
        (folder / "deeper" / "notes.txt").write_text("not at the top", encoding="utf-8")
        done = site.make_zip(folder, self.out, self.bundled)
        self.assertEqual(sorted(done["left_out"]), ["Thumbs.db", "ann/unused.png", "deeper/notes.txt"])
        with zipfile.ZipFile(self.out / done["file"]) as z:
            names = set(z.namelist())
        self.assertIn("test-people/README.txt", names)
        self.assertFalse(any("Thumbs" in n or "unused" in n or "notes.txt" in n for n in names))

    def test_a_pack_that_is_not_good_makes_nothing(self):
        folder = self.people()
        (folder / "ann" / "welcome.png").unlink()
        with self.assertRaises(site.SiteError) as ctx:
            site.make_zip(folder, self.out, self.bundled)
        self.assertIn("ann/welcome.png is not in the pack", str(ctx.exception))
        self.assertEqual(list(self.out.glob("*")) if self.out.exists() else [], [])

    def test_a_pack_cannot_take_the_id_of_one_that_comes_with_the_program(self):
        write_pack(self.bundled / "test-people", manifest())
        with self.assertRaises(site.SiteError) as ctx:
            site.make_zip(self.people(), self.out, self.bundled)
        self.assertIn("already comes with OpenStage Author", str(ctx.exception))
        self.assertEqual(list(self.out.glob("*.zip")) if self.out.exists() else [], [])

    def test_a_published_version_is_not_written_over_with_something_different(self):
        folder = self.people()
        site.make_zip(folder, self.out, self.bundled)
        site.make_zip(folder, self.out, self.bundled)  # the same again is fine
        (folder / "pack.json").write_text((folder / "pack.json").read_text(encoding="utf-8").replace("Two people", "Three people"), encoding="utf-8")
        with self.assertRaises(site.SiteError) as ctx:
            site.make_zip(folder, self.out, self.bundled)
        self.assertIn("Raise the version", str(ctx.exception))
        again = site.make_zip(folder, self.out, self.bundled, replace=True)
        self.assertEqual(hashlib.sha256((self.out / again["file"]).read_bytes()).hexdigest(), again["sha256"])


class ThePage(Site):
    def test_the_page_lists_each_pack_with_its_maker_licence_size_checksum_and_download(self):
        a = site.make_zip(self.people(), self.out, self.bundled)
        b = site.make_zip(self.rooms(), self.out, self.bundled)
        count, problems = site.make_page(self.out)
        self.assertEqual((count, problems), (2, []))
        text = (self.out / "index.html").read_text(encoding="utf-8")
        self.assertEqual(text.count("<h1"), 1)
        for done, title in ((a, "Test people"), (b, "Test rooms")):
            self.assertIn(f">{title}</h2>", text)
            self.assertIn(done["sha256"], text)
            self.assertIn(f'href="{done["file"]}" download>Download {title} (zip file, ', text)
        self.assertIn("A. Maker", text)
        self.assertIn('href="https://example.org/a"', text, "the maker's own page is linked when the pack gives one")
        self.assertIn("Public domain", text)
        self.assertIn("People: Ann, Bob.", text)
        self.assertIn("Groups: Offices (3), Halls (3).", text)
        self.assertIn('<html lang="en">', text)
        self.assertIn("Get more packs...", text, "the page names the button that brings people to it")
        self.assertNotIn("—", text)
        self.assertNotIn("<script", text, "the page needs no scripts")

    def test_every_picture_on_the_page_has_its_words_and_its_size_and_is_a_real_file(self):
        site.make_zip(self.people(), self.out, self.bundled)
        site.make_zip(self.rooms(), self.out, self.bundled)
        site.make_page(self.out)
        text = (self.out / "index.html").read_text(encoding="utf-8")
        images = re.findall(r"<img ([^>]+)>", text)
        self.assertEqual(len(images), 2 + 4, "two heads and four of the six backgrounds")
        for attrs in images:
            alt = re.search(r'alt="([^"]+)"', attrs)
            self.assertTrue(alt, attrs)
            self.assertRegex(attrs, r'width="\d+" height="\d+"')
            src = re.search(r'src="([^"]+)"', attrs).group(1)
            self.assertTrue((self.out / src).is_file(), src)

    def test_words_from_a_pack_cannot_break_the_page(self):
        hostile = write_pack(self.dir / "hostile", manifest(
            title="<b>Bold</b> & \"quoted\"", description="<script>alert(1)</script>",
            credit={"creator": "<i>Me</i>", "creatorUrl": "https://example.org/a\"onmouseover=\"x", "licence": "Free <b>to use</b>", "url": "https://example.org/p"}))
        site.make_zip(hostile, self.out, self.bundled)
        site.make_page(self.out)
        text = (self.out / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("<script", text)
        self.assertNotIn("<b>Bold", text)
        self.assertNotIn('onmouseover="x', text)
        self.assertIn("&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot;", text)

    def test_only_the_newest_version_of_a_pack_is_listed_by_number_and_not_by_letters(self):
        old = self.people()
        site.make_zip(old, self.out, self.bundled)
        site.make_page(self.out)
        self.assertEqual(sorted(p.name for p in (self.out / "previews").iterdir()), ["test-people-1.0.0"])
        newer = write_pack(self.dir / "people-new", manifest(version="1.10.0"))
        site.make_zip(newer, self.out, self.bundled)
        also = write_pack(self.dir / "people-mid", manifest(version="1.9.0"))
        site.make_zip(also, self.out, self.bundled)
        count, _ = site.make_page(self.out)
        self.assertEqual(count, 1)
        text = (self.out / "index.html").read_text(encoding="utf-8")
        self.assertIn("test-people-1.10.0.zip", text)
        self.assertNotIn("test-people-1.9.0.zip", text)
        self.assertNotIn("test-people-1.0.0.zip", text)
        self.assertTrue((self.out / "test-people-1.0.0.zip").is_file(), "the older file stays, so a link to it still works")
        self.assertEqual(sorted(p.name for p in (self.out / "previews").iterdir()), ["test-people-1.10.0"], "pictures of older versions are cleared away")

    def test_a_file_that_is_not_a_pack_is_reported_and_left_off_the_page(self):
        site.make_zip(self.people(), self.out, self.bundled)
        (self.out / "junk.zip").write_bytes(b"not a zip")
        (self.out / "other.zip").write_bytes(b"")
        with zipfile.ZipFile(self.out / "wrong.zip", "w") as z:
            z.writestr("hello.txt", "no pack.json here")
        count, problems = site.make_page(self.out)
        self.assertEqual(count, 1)
        self.assertEqual(len(problems), 3)
        self.assertTrue(any("junk.zip" in p for p in problems))
        self.assertTrue(any("wrong.zip" in p and "pack.json" in p for p in problems))

    def test_with_no_packs_the_page_says_so(self):
        count, _ = site.make_page(self.out)
        self.assertEqual(count, 0)
        self.assertIn("No packs are listed yet.", (self.out / "index.html").read_text(encoding="utf-8"))

    def test_the_page_is_the_same_each_time(self):
        site.make_zip(self.people(), self.out, self.bundled)
        site.make_page(self.out)
        first = (self.out / "index.html").read_bytes()
        site.make_page(self.out)
        self.assertEqual(first, (self.out / "index.html").read_bytes())


class TheCommandLine(Site):
    def run_main(self, *args):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = site.main(list(args))
        return code, buffer.getvalue()

    def test_it_makes_the_zip_and_the_page_and_says_what_it_did(self):
        code, said = self.run_main(str(self.people()), "--out", str(self.out), "--bundled", str(self.bundled))
        self.assertEqual(code, 0)
        self.assertIn("Made test-people-1.0.0.zip: 2 people", said)
        self.assertIn("SHA-256: ", said)
        self.assertIn("lists 1 pack.", said)
        self.assertTrue((self.out / "index.html").is_file())

    def test_a_bad_pack_stops_it_with_words_and_a_failing_exit_code(self):
        folder = self.people()
        (folder / "pack.json").write_text("{ not json", encoding="utf-8")
        code, said = self.run_main(str(folder), "--out", str(self.out), "--bundled", str(self.bundled))
        self.assertEqual(code, 1)
        self.assertIn("Stopped:", said)
        self.assertIn("not written as JSON", said)

    def test_with_no_folders_it_only_makes_the_page_again(self):
        site.make_zip(self.people(), self.out, self.bundled)
        self.assertFalse((self.out / "index.html").exists(), "making a zip alone does not touch the page")
        code, said = self.run_main("--out", str(self.out))
        self.assertEqual(code, 0)
        self.assertTrue((self.out / "index.html").is_file())
        self.assertIn("lists 1 pack.", said)


if __name__ == "__main__":
    unittest.main()
