# SPDX-License-Identifier: Apache-2.0
"""Tests for character packs: what a good pack is, listing them, installing one from a zip file, and removing one."""
import contextlib
import io
import json
import os
import pathlib
import shutil
import struct
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import charpack as c  # noqa: E402
import pngio  # noqa: E402


def picture(w=32, h=48, shade=100):
    return pngio.write_png(w, h, bytearray(bytes((shade, 20, 30, 255)) * (w * h)))


def manifest(**over):
    base = {
        "packVersion": 1, "id": "test-people", "title": "Test people", "version": "1.0.0", "description": "Two people for tests.",
        "credit": {"creator": "A. Maker", "creatorUrl": "https://example.org/a", "licence": "Free to use in OpenStage courses", "url": "https://example.org/packs"},
        "people": [
            {"id": "ann", "name": "Ann", "role": "Nurse", "voice": "female", "alt": "Ann, a woman in a blue coat.", "head": "ann/head.png",
             "poses": [{"id": "neutral", "label": "Standing", "alt": "Ann standing.", "file": "ann/neutral.png"}, {"id": "welcome", "label": "Waving", "alt": "Ann waving.", "file": "ann/welcome.png"}]},
            {"id": "bob", "name": "Bob", "voice": "male", "alt": "Bob, a man in a grey suit.", "head": "bob/head.png", "poses": []},
        ],
    }
    base.update(over)
    return base


def write_pack(folder, data=None, pictures=None):
    folder = pathlib.Path(folder)
    data = data or manifest()
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "pack.json").write_text(json.dumps(data), encoding="utf-8")
    for rel in pictures if pictures is not None else c.files_named(c.clean_manifest(data)):
        target = folder / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(picture())
    return folder


def zip_of(path, files, top=""):
    with zipfile.ZipFile(path, "w") as z:
        for name, data in files.items():
            z.writestr((top + "/" if top else "") + name, data)
    return path


def good_files():
    files = {"pack.json": json.dumps(manifest())}
    for rel in c.files_named(c.clean_manifest(manifest())):
        files[rel] = picture()
    return files


class Temp(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="openstage-packs-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.bundled = self.dir / "bundled"
        self.yours = self.dir / "yours"

    def refused(self, fn, *args, word=""):
        with self.assertRaises(c.PackError) as ctx:
            fn(*args)
        self.assertIn(word.lower(), str(ctx.exception).lower())


class TheManifest(Temp):
    def test_a_good_pack_is_accepted_and_cleaned(self):
        m = c.check_pack(write_pack(self.dir / "p"))
        self.assertEqual(m["id"], "test-people")
        self.assertEqual([p["id"] for p in m["people"]], ["ann", "bob"])
        self.assertEqual(m["people"][1]["role"], "")
        self.assertEqual(m["people"][0]["poses"][1]["file"], "ann/welcome.png")
        self.assertGreater(m["bytes"], 0)

    def test_each_mistake_is_named_in_words(self):
        cases = [
            ({"packVersion": 3}, "packVersion"),
            ({"id": "Bad Id"}, "\"id\""),
            ({"version": "one"}, "version"),
            ({"title": ""}, "title"),
            ({"credit": None}, "credit"),
            ({"credit": {"creator": "A", "licence": "L", "url": ""}}, "\"url\" is needed"),
            ({"credit": {"creator": "A", "licence": "L", "url": "ftp://x"}}, "http"),
            ({"credit": {"creator": "", "licence": "L", "url": "https://x.org"}}, "\"creator\" is needed"),
            ({"people": []}, "from 1 to"),
        ]
        for over, word in cases:
            with self.subTest(over=over):
                self.refused(c.clean_manifest, manifest(**over), word=word)

    def test_a_person_is_checked(self):
        def with_person(**over):
            m = manifest()
            m["people"][0].update(over)
            return m
        for over, word in (
            ({"id": "you"}, "not \"you\""),
            ({"id": "Ann"}, "lower case"),
            ({"id": "bob"}, "used twice"),
            ({"name": " "}, "\"name\" is needed"),
            ({"voice": "robot"}, "voice"),
            ({"alt": ""}, "\"alt\" is needed"),
            ({"head": "../ann/head.png"}, "plain place"),
            ({"head": "ann/head.gif"}, ".png or .webp"),
            ({"head": "a/b/c/d.png"}, "plain place"),
            ({"head": "C:/x.png"}, "plain place"),
            ({"poses": [{"id": "x", "label": "", "alt": "a", "file": "ann/x.png"}]}, "\"label\" is needed"),
            ({"poses": [{"id": "x", "label": "X", "alt": "", "file": "ann/x.png"}]}, "\"alt\" is needed"),
            ({"poses": [{"id": "x", "label": "X", "alt": "a", "file": "ann/x.png"}, {"id": "x", "label": "Y", "alt": "b", "file": "ann/y.png"}]}, "used twice"),
            ({"poses": "none"}, "list"),
        ):
            with self.subTest(over=over):
                self.refused(c.clean_manifest, with_person(**over), word=word)

    def test_the_standard_poses_have_words(self):
        for pose_id, label in c.STANDARD_POSES.items():
            self.assertRegex(pose_id, c.PERSON_ID)
            self.assertTrue(label)


class ThePicturesInside(Temp):
    def test_a_missing_picture_is_named(self):
        folder = write_pack(self.dir / "p")
        (folder / "ann" / "welcome.png").unlink()
        self.refused(c.check_pack, folder, word="ann/welcome.png is not in the pack")

    def test_a_file_that_is_not_a_picture_is_refused_whatever_it_is_called(self):
        folder = write_pack(self.dir / "p")
        (folder / "bob" / "head.png").write_text("<script>alert(1)</script>", encoding="utf-8")
        self.refused(c.check_pack, folder, word="not a real PNG")

    def test_a_picture_that_is_too_small_or_too_large_is_refused(self):
        folder = write_pack(self.dir / "p")
        (folder / "bob" / "head.png").write_bytes(picture(8, 8))
        self.refused(c.check_pack, folder, word="8 by 8")
        (folder / "bob" / "head.png").write_bytes(picture(100, 100))
        old = c.MAX_PICTURE_BYTES
        c.MAX_PICTURE_BYTES = 10
        self.addCleanup(setattr, c, "MAX_PICTURE_BYTES", old)
        self.refused(c.check_pack, folder, word="larger than")

    def test_a_pack_without_pack_json_or_with_broken_json_is_refused(self):
        folder = self.dir / "empty"
        folder.mkdir()
        self.refused(c.check_pack, folder, word="no pack.json")
        (folder / "pack.json").write_text("{not json", encoding="utf-8")
        self.refused(c.check_pack, folder, word="JSON")

    def test_two_entries_for_one_file_are_refused(self):
        m = manifest()
        m["people"][1]["head"] = "ann/head.png"
        self.refused(c.check_pack, write_pack(self.dir / "p", m), word="same file")

    def test_webp_sizes_are_read_from_the_three_kinds(self):
        lossy = b"RIFF" + b"\0\0\0\0" + b"WEBP" + b"VP8 " + b"\0\0\0\0" + b"\0\0\0" + b"\x9d\x01\x2a" + struct.pack("<HH", 300, 400) + b"\0" * 10
        lossless_bits = (200 - 1) | ((100 - 1) << 14)
        lossless = b"RIFF" + b"\0\0\0\0" + b"WEBP" + b"VP8L" + b"\0\0\0\0" + b"\x2f" + struct.pack("<I", lossless_bits) + b"\0" * 10
        extended = b"RIFF" + b"\0\0\0\0" + b"WEBP" + b"VP8X" + b"\0\0\0\0" + b"\0\0\0\0" + (639).to_bytes(3, "little") + (479).to_bytes(3, "little") + b"\0" * 6
        self.assertEqual(c.picture_size("a.webp", lossy), (300, 400))
        self.assertEqual(c.picture_size("a.webp", lossless), (200, 100))
        self.assertEqual(c.picture_size("a.webp", extended), (640, 480))
        self.refused(c.picture_size, "a.webp", b"RIFF....WAVEfmt " + b"\0" * 30, word="not a real WebP")


class ThePacksHere(Temp):
    def test_good_packs_are_listed_the_bundled_ones_first_and_broken_ones_say_why(self):
        write_pack(self.bundled / "test-people")
        other = manifest(id="other-people", title="Other")
        write_pack(self.yours / "other-people", other)
        write_pack(self.yours / "damaged", manifest(id="damaged-pack"), pictures=[])
        (self.yours / "not-a-pack").mkdir()
        (self.yours / ".installing-1").mkdir()
        out = c.list_packs(str(self.bundled), str(self.yours))
        self.assertEqual([(p["id"], p["source"]) for p in out["packs"]], [("test-people", "bundled"), ("other-people", "yours")])
        self.assertEqual([b["folder"] for b in out["broken"]], ["damaged"])
        self.assertIn("is not in the pack", out["broken"][0]["message"])

    def test_a_second_pack_with_the_same_id_is_not_used(self):
        write_pack(self.bundled / "test-people")
        write_pack(self.yours / "copy-of-it")
        out = c.list_packs(str(self.bundled), str(self.yours))
        self.assertEqual(len(out["packs"]), 1)
        self.assertIn("already has the id", out["broken"][0]["message"])

    def test_folders_that_are_not_there_are_fine(self):
        self.assertEqual(c.list_packs(str(self.bundled), str(self.yours)), {"ok": True, "packs": [], "broken": []})
        self.assertEqual(c.list_packs("", ""), {"ok": True, "packs": [], "broken": []})

    def test_a_pack_is_found_by_its_id_and_only_by_a_good_one(self):
        write_pack(self.bundled / "test-people")
        found = c.find_pack("test-people", str(self.bundled), str(self.yours))
        self.assertEqual(found, (self.bundled / "test-people", "bundled"))
        self.assertIsNone(c.find_pack("nothing-here", str(self.bundled), str(self.yours)))
        self.assertIsNone(c.find_pack("../x", str(self.bundled), str(self.yours)))
        self.assertIsNone(c.find_pack(None, str(self.bundled), str(self.yours)))


class Installing(Temp):
    def install(self, files, top="", name="pack.zip"):
        zip_path = zip_of(self.dir / name, files, top)
        return c.install_zip(zip_path, str(self.bundled), str(self.yours))

    def test_a_good_zip_is_installed_and_shows_in_the_list(self):
        answer = self.install(good_files())
        self.assertTrue(answer["ok"])
        self.assertEqual((answer["id"], answer["replaced"]), ("test-people", False))
        self.assertIn("Installed the character pack \"Test people\" version 1.0.0", answer["message"])
        self.assertEqual([p["id"] for p in c.list_packs(str(self.bundled), str(self.yours))["packs"]], ["test-people"])
        self.assertEqual([p.name for p in self.yours.iterdir()], ["test-people"])

    def test_a_zip_with_everything_inside_one_folder_is_installed_too(self):
        self.assertTrue(self.install(good_files(), top="test-people-1.0")["ok"])
        self.assertTrue((self.yours / "test-people" / "ann" / "head.png").is_file())

    def test_installing_again_updates_and_says_which_version_it_was(self):
        self.install(good_files())
        newer = good_files()
        newer["pack.json"] = json.dumps(manifest(version="1.1.0"))
        answer = self.install(newer, name="newer.zip")
        self.assertTrue(answer["replaced"])
        self.assertIn("Updated", answer["message"])
        self.assertIn("it was version 1.0.0", answer["message"])
        self.assertEqual(c.list_packs("", str(self.yours))["packs"][0]["version"], "1.1.0")
        self.assertEqual([p.name for p in self.yours.iterdir()], ["test-people"])

    def test_a_pack_that_comes_with_the_program_is_not_replaced(self):
        write_pack(self.bundled / "test-people")
        with self.assertRaises(c.PackError) as ctx:
            self.install(good_files())
        self.assertIn("already comes with OpenStage Author", str(ctx.exception))
        self.assertFalse(self.yours.exists() and any(self.yours.iterdir()))

    def test_names_that_climb_out_or_name_other_places_are_refused_and_nothing_is_kept(self):
        for bad in ("../evil.png", "/abs.png", "ann\\..\\evil.png", "C:evil.png", "a/../../evil.png", ".hidden.png"):
            with self.subTest(bad=bad):
                files = good_files()
                files[bad] = picture()
                with self.assertRaises(c.PackError) as ctx:
                    self.install(files)
                self.assertIn("not allowed", str(ctx.exception))
                self.assertFalse(self.yours.exists() and any(self.yours.iterdir()))

    def test_only_pictures_and_words_are_allowed_in(self):
        for bad in ("run.exe", "ann/x.svg", "tools.py", "ann/readme.html", "ann/x.png.exe", "sub/pack.json"):
            with self.subTest(bad=bad):
                files = good_files()
                files[bad] = b"MZ"
                with self.assertRaises(c.PackError) as ctx:
                    self.install(files)
                self.assertIn("only pictures", str(ctx.exception))

    def test_a_readme_and_a_licence_are_allowed(self):
        files = good_files()
        files["README.txt"] = "About these pictures"
        files["LICENCE.md"] = "The licence"
        self.assertTrue(self.install(files)["ok"])

    def test_a_link_inside_the_zip_is_refused(self):
        zip_path = self.dir / "link.zip"
        with zipfile.ZipFile(zip_path, "w") as z:
            for name, data in good_files().items():
                z.writestr(name, data)
            link = zipfile.ZipInfo("ann/link.png")
            link.external_attr = (0o120777 << 16)
            z.writestr(link, "head.png")
        with self.assertRaises(c.PackError) as ctx:
            c.install_zip(zip_path, str(self.bundled), str(self.yours))
        self.assertIn("link", str(ctx.exception))

    def test_a_file_that_is_too_large_is_refused(self):
        old = c.MAX_PICTURE_BYTES
        c.MAX_PICTURE_BYTES = 60
        self.addCleanup(setattr, c, "MAX_PICTURE_BYTES", old)
        with self.assertRaises(c.PackError) as ctx:
            self.install(good_files())
        self.assertIn("larger than", str(ctx.exception))
        self.assertFalse(self.yours.exists() and any(self.yours.iterdir()))

    def test_a_zip_that_lies_about_a_files_size_is_stopped_while_it_is_unpacked(self):
        # The size written in the zip's index is changed to be tiny; the file itself is not.
        zip_path = zip_of(self.dir / "liar.zip", good_files())
        data = bytearray(zip_path.read_bytes())
        name = b"ann/head.png"
        pos = data.index(b"PK\x03\x04" + b"", 0)
        # Patch every local header and central header size field for ann/head.png to 1 byte.
        for sig, offset in ((b"PK\x03\x04", 22), (b"PK\x01\x02", 24)):
            start = 0
            while True:
                i = data.find(sig, start)
                if i < 0:
                    break
                n = struct.unpack("<H", data[i + (26 if sig == b"PK\x03\x04" else 28):i + (28 if sig == b"PK\x03\x04" else 30)])[0]
                fname = bytes(data[i + (30 if sig == b"PK\x03\x04" else 46):i + (30 if sig == b"PK\x03\x04" else 46) + n])
                if fname == name:
                    data[i + offset:i + offset + 4] = struct.pack("<I", 1)
                start = i + 4
        zip_path.write_bytes(bytes(data))
        old = c.MAX_PICTURE_BYTES
        c.MAX_PICTURE_BYTES = 100
        self.addCleanup(setattr, c, "MAX_PICTURE_BYTES", old)
        with self.assertRaises(c.PackError):
            c.install_zip(zip_path, str(self.bundled), str(self.yours))
        self.assertFalse(self.yours.exists() and any(self.yours.iterdir()))

    def test_things_that_are_not_packs_are_refused_with_words(self):
        (self.dir / "text.zip").write_text("not a zip", encoding="utf-8")
        with self.assertRaises(c.PackError) as ctx:
            c.install_zip(self.dir / "text.zip", "", str(self.yours))
        self.assertIn("not a zip file", str(ctx.exception))
        with self.assertRaises(c.PackError) as ctx:
            self.install({"readme.txt": "hello"})
        self.assertIn("no pack.json", str(ctx.exception))
        with self.assertRaises(c.PackError) as ctx:
            self.install({"pack.json": "{}"})
        self.assertIn("packVersion", str(ctx.exception))

    def test_a_pack_with_a_missing_picture_is_not_kept(self):
        files = good_files()
        del files["ann/welcome.png"]
        with self.assertRaises(c.PackError):
            self.install(files)
        self.assertFalse(self.yours.exists() and any(self.yours.iterdir()))

    def test_names_that_differ_only_by_capitals_are_refused(self):
        files = good_files()
        files["ANN/head.png"] = picture()
        with self.assertRaises(c.PackError) as ctx:
            self.install(files)
        self.assertIn("capital letters", str(ctx.exception))


def backgrounds(**over):
    """A pack of backgrounds only (packVersion 2)."""
    base = {
        "packVersion": 2, "id": "test-rooms", "title": "Test rooms", "version": "1.0.0", "description": "Two rooms for tests.",
        "credit": {"creator": "A. Maker", "creatorUrl": "", "licence": "Free to use in OpenStage courses", "url": "https://example.org/packs"},
        "backgrounds": [
            {"id": "office-1", "name": "Open-plan office", "group": "Offices", "alt": "An empty open-plan office with long desks.", "file": "rooms/office-1.png"},
            {"id": "hall-1", "name": "Corridor", "group": "", "alt": "A long corridor with glass walls.", "file": "rooms/hall-1.png"},
        ],
    }
    base.update(over)
    return base


class Backgrounds(Temp):
    """A pack can hold backgrounds (pictures to put behind a slide), with or without people: packVersion 2."""

    def test_a_pack_of_backgrounds_alone_is_good_and_says_what_it_holds(self):
        m = c.check_pack(write_pack(self.dir / "p", backgrounds()))
        self.assertEqual(m["people"], [])
        self.assertEqual([b["id"] for b in m["backgrounds"]], ["office-1", "hall-1"])
        self.assertEqual(m["backgrounds"][1]["group"], "")
        self.assertEqual(c.contents(m), "2 backgrounds")
        self.assertEqual(c.pack_kind(m), "background pack")
        self.assertEqual(c.files_named(m), ["rooms/office-1.png", "rooms/hall-1.png"])

    def test_a_pack_can_hold_people_and_backgrounds(self):
        data = manifest(packVersion=2, backgrounds=backgrounds()["backgrounds"])
        m = c.check_pack(write_pack(self.dir / "p", data))
        self.assertEqual(c.contents(m), "2 people and 2 backgrounds")
        self.assertEqual(c.pack_kind(m), "pack")
        self.assertIn("rooms/hall-1.png", c.files_named(m))

    def test_a_pack_of_people_is_still_a_character_pack_at_either_version(self):
        for version in (1, 2):
            m = c.clean_manifest(manifest(packVersion=version))
            self.assertEqual(m["backgrounds"], [])
            self.assertEqual(c.pack_kind(m), "character pack")
            self.assertEqual(c.contents(m), "2 people")
            self.assertEqual(m["packVersion"], version)

    def test_backgrounds_need_packversion_2(self):
        self.refused(c.clean_manifest, backgrounds(packVersion=1), word="packVersion")
        self.refused(c.clean_manifest, backgrounds(packVersion=3), word="packVersion")

    def test_a_pack_with_nothing_in_it_is_refused(self):
        self.refused(c.clean_manifest, backgrounds(backgrounds=[]), word="from 1 to")
        self.refused(c.clean_manifest, manifest(packVersion=2, people=[]), word="from 1 to")
        data = backgrounds()
        del data["backgrounds"]
        self.refused(c.clean_manifest, data, word="from 1 to")

    def test_each_mistake_in_a_background_is_named_in_words(self):
        def with_one(**over):
            data = backgrounds()
            data["backgrounds"][0].update(over)
            return data
        for over, word in (
            ({"id": "Office"}, "lower case"),
            ({"id": "hall-1"}, "used twice"),
            ({"name": ""}, "\"name\" is needed"),
            ({"name": "x" * 61}, "too long"),
            ({"alt": ""}, "\"alt\" is needed"),
            ({"alt": "x" * 301}, "too long"),
            ({"group": "x" * 41}, "too long"),
            ({"file": "../office.png"}, "plain place"),
            ({"file": "rooms/office-1.jpg"}, ".png or .webp"),
            ({"file": "a/b/c/d.png"}, "plain place"),
        ):
            with self.subTest(over=over):
                self.refused(c.clean_manifest, with_one(**over), word=word)
        self.refused(c.clean_manifest, backgrounds(backgrounds="none"), word="from 1 to")
        self.refused(c.clean_manifest, backgrounds(backgrounds=["x"]), word="must be an object")
        self.refused(c.clean_manifest, backgrounds(backgrounds=[backgrounds()["backgrounds"][0]] * 201), word="from 1 to")

    def test_the_pictures_are_checked_like_any_other(self):
        folder = write_pack(self.dir / "p", backgrounds())
        (folder / "rooms" / "hall-1.png").unlink()
        self.refused(c.check_pack, folder, word="is not in the pack")
        folder = write_pack(self.dir / "q", backgrounds())
        (folder / "rooms" / "hall-1.png").write_bytes(b"not a picture at all, just words")
        self.refused(c.check_pack, folder, word="not a real PNG")

    def test_two_entries_for_one_file_are_refused(self):
        data = backgrounds()
        data["backgrounds"][1]["file"] = data["backgrounds"][0]["file"]
        self.refused(c.check_pack, write_pack(self.dir / "p", data), word="same file")

    def test_a_pack_of_backgrounds_is_installed_from_a_zip_and_listed_with_them(self):
        files = {"pack.json": json.dumps(backgrounds())}
        for rel in c.files_named(c.clean_manifest(backgrounds())):
            files[rel] = picture()
        answer = c.install_zip(zip_of(self.dir / "rooms.zip", files), self.bundled, self.yours)
        self.assertEqual(answer["message"], "Installed the background pack \"Test rooms\" version 1.0.0: 2 backgrounds.")
        listed = c.list_packs(self.bundled, self.yours)["packs"]
        self.assertEqual([p["id"] for p in listed], ["test-rooms"])
        self.assertEqual(len(listed[0]["backgrounds"]), 2)
        self.assertEqual(listed[0]["people"], [])

    def test_the_command_line_counts_backgrounds(self):
        folder = write_pack(self.dir / "p", backgrounds())
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            c.main(["check", str(folder)])
        self.assertIn("2 backgrounds", json.loads(out.getvalue())["message"])


class Removing(Temp):
    def test_a_pack_you_added_can_be_removed_and_one_that_came_with_the_program_cannot(self):
        write_pack(self.yours / "test-people")
        self.assertEqual(c.remove_pack("test-people", str(self.yours))["ok"], True)
        self.assertFalse((self.yours / "test-people").exists())
        write_pack(self.bundled / "test-people")
        with self.assertRaises(c.PackError):
            c.remove_pack("test-people", str(self.yours))
        self.assertTrue((self.bundled / "test-people").exists())

    def test_what_is_not_a_pack_name_is_refused(self):
        for bad in ("..", "../x", "a/b", "", None):
            with self.assertRaises(c.PackError):
                c.remove_pack(bad, str(self.yours))


class TheCommandLine(Temp):
    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = c.main(list(argv))
        return code, json.loads(out.getvalue())

    def test_each_command_prints_one_line_of_json(self):
        write_pack(self.bundled / "test-people")
        code, answer = self.run_cli("list", "--bundled", str(self.bundled), "--yours", str(self.yours))
        self.assertEqual((code, [p["id"] for p in answer["packs"]]), (0, ["test-people"]))
        code, answer = self.run_cli("check", str(self.bundled / "test-people"))
        self.assertEqual(code, 0)
        self.assertTrue(answer["ok"])
        zip_path = zip_of(self.dir / "p.zip", {**good_files(), "pack.json": json.dumps(manifest(id="another-one"))})
        code, answer = self.run_cli("install", str(zip_path), "--bundled", str(self.bundled), "--yours", str(self.yours))
        self.assertTrue(answer["ok"], answer)
        code, answer = self.run_cli("remove", "another-one", "--yours", str(self.yours))
        self.assertTrue(answer["ok"])

    def test_a_refusal_is_an_answer_not_a_crash(self):
        code, answer = self.run_cli("install", str(self.dir / "nothing.zip"), "--bundled", "", "--yours", str(self.yours))
        self.assertEqual(code, 0)
        self.assertFalse(answer["ok"])
        self.assertIn("zip", answer["message"])


if __name__ == "__main__":
    unittest.main()
