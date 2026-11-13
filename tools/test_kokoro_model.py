"""Tests for tools/kokoro_model.py and the list it reads. None of them uses the network. Run with:  python tools/test_kokoro_model.py
"""
import hashlib
import json
import pathlib
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import kokoro_model  # noqa: E402


class TheList(unittest.TestCase):
    def test_it_names_one_fixed_commit_and_every_file_kokoro_uses(self):
        repo, revision, files = kokoro_model.model_list()
        self.assertEqual(repo, "hexgrad/Kokoro-82M")
        self.assertEqual(len(revision), 40)
        self.assertIn("config.json", files)
        self.assertIn("kokoro-v1_0.pth", files)
        voices = set(json.loads((HERE / "kokoro-voices.json").read_text(encoding="utf-8"))["voices"])
        listed = {rel[len("voices/"):-len(".pt")] for rel in files if rel.startswith("voices/")}
        self.assertEqual(listed, voices, "a file for every voice the editor offers, and no other")
        self.assertEqual(set(files), {"config.json", "kokoro-v1_0.pth"} | {f"voices/{v}.pt" for v in voices})

    def test_a_list_without_a_fixed_commit_or_with_a_file_outside_the_model_is_refused(self):
        good = {"repo": "r/m", "revision": "a" * 40, "files": {"config.json": {"size": 1, "sha256": "0" * 64}}}
        for bad in (
            {**good, "revision": "main"},
            {**good, "files": {}},
            {**good, "files": {"../x": {"size": 1, "sha256": "0" * 64}}},
            {**good, "files": {"config.json": {"size": 1}}},
        ):
            with tempfile.TemporaryDirectory() as d:
                path = pathlib.Path(d, "list.json")
                path.write_text(json.dumps(bad), encoding="utf-8")
                with self.assertRaises(kokoro_model.ModelError):
                    kokoro_model.model_list(path)


class Checking(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.snapshot = pathlib.Path(self.dir.name, "models--r--m", "snapshots", "b" * 40)
        (self.snapshot / "voices").mkdir(parents=True)
        self.files = {}
        for rel, data in (("config.json", b"{}"), ("voices/af_heart.pt", b"voice")):
            pathlib.Path(self.snapshot, *rel.split("/")).write_bytes(data)
            self.files[rel] = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}

    def tearDown(self):
        self.dir.cleanup()

    def test_files_that_match_pass(self):
        self.assertEqual(kokoro_model.mismatches(self.snapshot, self.files), [])

    def test_a_missing_a_resized_and_a_changed_file_are_each_reported(self):
        files = {**self.files, "kokoro-v1_0.pth": {"size": 3, "sha256": "0" * 64}}
        (self.snapshot / "config.json").write_bytes(b"{ }")
        (self.snapshot / "voices" / "af_heart.pt").write_bytes(b"VOICE")
        wrong = dict(kokoro_model.mismatches(self.snapshot, files))
        self.assertEqual(wrong["kokoro-v1_0.pth"], "missing")
        self.assertIn("bytes", wrong["config.json"])
        self.assertIn("SHA-256", wrong["voices/af_heart.pt"])

    def test_a_file_that_did_not_match_is_deleted(self):
        kokoro_model.remove(self.snapshot, "voices/af_heart.pt")
        self.assertFalse((self.snapshot / "voices" / "af_heart.pt").exists())

    def test_main_is_pointed_at_the_commit_and_only_for_a_snapshot_of_it(self):
        kokoro_model.point_main(self.snapshot, "b" * 40)
        self.assertEqual((self.snapshot.parent.parent / "refs" / "main").read_text(encoding="ascii"), "b" * 40)
        with self.assertRaises(kokoro_model.ModelError):
            kokoro_model.point_main(self.snapshot, "c" * 40)


if __name__ == "__main__":
    unittest.main()
