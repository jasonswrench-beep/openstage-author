# SPDX-License-Identifier: Apache-2.0
"""Tests for the parts of the installer build that need no download and no build."""
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import build_installer as b  # noqa: E402


class Pieces(unittest.TestCase):
    def test_the_resource_list_is_the_whole_payload_folder_landing_beside_the_program(self):
        # A map with a folder and a target of "" copies the folder's contents with its own folders kept (a glob would flatten them: found the hard way).
        found = b.resources()
        self.assertEqual(len(found), 1)
        (source, target), = found.items()
        self.assertTrue(source.endswith("dist/installer-staging/payload/"), source)
        self.assertEqual(target, "")
        self.assertNotIn("*", source)

    def test_checksums_are_the_usual_ones(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d) / "x"
            p.write_bytes(b"abc")
            self.assertEqual(b.md5(p), "900150983cd24fb0d6963f7d28e17f72")
            self.assertEqual(b.sha256(p), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

    def test_what_goes_in_names_only_things_that_exist(self):
        for name in b.TOOLS:
            self.assertTrue((b.ROOT / "tools" / name).is_file(), name)
        for name in b.EXAMPLES:
            self.assertTrue((b.ROOT / "examples" / name).is_dir(), name)

    def test_what_the_uninstall_screen_offers_to_delete_is_named(self):
        text = (b.TAURI / "installer" / "English.nsh").read_text(encoding="utf-8-sig")
        self.assertIn('LangString deleteAppData ${LANG_ENGLISH} "Also delete my settings, models and narration voice"', text)
        import json
        conf = json.loads((b.TAURI / "tauri.installer.conf.json").read_text(encoding="utf-8"))
        self.assertEqual(conf["bundle"]["windows"]["nsis"]["customLanguageFiles"], {"English": "installer/English.nsh"})
        # Tauri puts its own byte order mark on a custom language file; a second one makes the installer maker fail ("Invalid command").
        self.assertNotEqual((b.TAURI / "installer" / "English.nsh").read_bytes()[:3], b"\xef\xbb\xbf")

    def test_the_trial_has_its_own_name_and_identifier_and_the_real_one_is_not_touched(self):
        import json
        self.assertNotEqual(b.TRIAL["identifier"], json.loads((b.TAURI / "tauri.conf.json").read_text(encoding="utf-8"))["identifier"])
        self.assertTrue(b.TRIAL["identifier"].startswith("com.openstageauthor.editor."))

    def test_nothing_from_the_gpl_family_is_named_in_what_goes_in(self):
        # The narration engine is installed on the author's own computer afterwards (docs/decisions/0004-packaging-and-narration.md); none of it travels in the installer.
        packages = " ".join(b.PIP_PACKAGES).lower()
        for word in ("espeak", "phonemizer", "piper", "kokoro", "torch", "misaki"):
            self.assertNotIn(word, packages, word)


if __name__ == "__main__":
    unittest.main()
