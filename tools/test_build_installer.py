# SPDX-License-Identifier: Apache-2.0
"""Tests for the parts of the installer build that need no download and no build."""
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import build_installer as b  # noqa: E402
import sign_windows  # noqa: E402


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
        # The editor finds the packs that come with the program by this file, so an installer without it would show no one in the library.
        self.assertTrue((b.ROOT / "character-packs" / "README.txt").is_file())
        self.assertTrue(any((b.ROOT / "character-packs").glob("*/pack.json")))

    def test_every_tool_the_editor_runs_by_name_goes_in(self):
        # The editor looks for its Python tools by name next to the program. One that is not in the installer works from a checkout and fails for everyone
        # who installed (the translation tool and the review document were found missing this way).
        import re

        source = (b.TAURI / "src" / "lib.rs").read_text(encoding="utf-8")
        named = set(re.findall(r'find_tool\("([^"]+)"\)', source))
        self.assertTrue({"validate.py", "xliff.py", "narrate.py"} <= named, named)
        self.assertEqual(sorted(named - set(b.TOOLS)), [])

    def test_the_mcp_server_is_built_into_the_payload_under_the_name_the_editor_looks_for(self):
        # An assistant is connected to a single file beside the program. If the installer called it one thing and the editor looked for another, the MCP access
        # dialog would say the program was not found on every installed copy and work from a checkout.
        self.assertTrue((b.ROOT / "mcp" / "build.mjs").is_file())
        self.assertTrue((b.ROOT / "mcp" / "server.ts").is_file())
        self.assertEqual(b.MCP_SERVER, "openstage-mcp.mjs")
        shell = (b.TAURI / "src" / "lib.rs").read_text(encoding="utf-8")
        self.assertIn(f'"mcp/{b.MCP_SERVER}"', shell)
        # Building it uses the player's esbuild, which goes in the same way.
        self.assertIn(("esbuild",), b.PLAYER_PACKAGES)

    def test_the_tools_that_read_a_shared_file_have_it_with_them(self):
        # validate.py reads these when it starts, so without them the problem check does not even run.
        for name in ("download-types.json", "player-text.json", "theme-rules.json"):
            self.assertIn(name, b.TOOLS)

    def test_what_the_uninstall_screen_offers_to_delete_is_named(self):
        text = (b.TAURI / "installer" / "English.nsh").read_text(encoding="utf-8-sig")
        self.assertIn('LangString deleteAppData ${LANG_ENGLISH} "Also delete my settings, models, narration voice and character packs"', text)
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


class Signing(unittest.TestCase):
    def test_only_pips_launchers_and_wrappers_are_left_unsigned_on_purpose(self):
        site = "python/Lib/site-packages/"
        templates = {site + "pip/_vendor/distlib/" + n for n in ("t32.exe", "t64.exe", "t64-arm.exe", "w32.exe", "w64.exe", "w64-arm.exe")}
        wrappers = {site + "bin/" + n for n in ("jsonschema.exe", "pip.exe", "pip3.exe", "pip3.11.exe")}
        self.assertEqual(b.LEAVE_UNSIGNED, templates | wrappers)

    def test_the_templates_stay_because_the_narration_install_uses_pip(self):
        # pip copies a launcher template for each package with commands of its own that it installs. If the narration install ever stops using pip, the
        # reason for keeping the templates (LEAVE_UNSIGNED) should be looked at again.
        engine = (b.TAURI / "src" / "engine.rs").read_text(encoding="utf-8")
        self.assertIn('"-m", "pip", "install"', engine)
        self.assertIn('"--target"', engine)

    def test_a_file_left_unsigned_is_found_by_its_exact_place_also_one_folder_deeper(self):
        kept = "python/Lib/site-packages/pip/_vendor/distlib/t64.exe"
        self.assertTrue(b.left_unsigned_on_purpose(kept))
        self.assertTrue(b.left_unsigned_on_purpose("$INSTDIR/" + kept))
        self.assertTrue(b.left_unsigned_on_purpose(kept.replace("/", "\\")))
        self.assertFalse(b.left_unsigned_on_purpose("t64.exe"))
        self.assertFalse(b.left_unsigned_on_purpose("speech/t64.exe"))
        self.assertFalse(b.left_unsigned_on_purpose("python/Lib/site-packages/rpds/rpds.cp311-win_amd64.pyd"))
        self.assertFalse(b.left_unsigned_on_purpose("x" + kept))

    def test_program_files_are_programs_and_libraries_including_pyd(self):
        # A .pyd is a library for Python; Tauri's own signing of resource DLLs may not count it, so the payload step must.
        with tempfile.TemporaryDirectory() as d:
            for name in ("a.exe", "B.DLL", "c.pyd", "d.txt", "e.json", "sub/f.Exe"):
                p = pathlib.Path(d) / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b"")
            self.assertEqual(sorted(p.name for p in b.program_files(d)), ["B.DLL", "a.exe", "c.pyd", "f.Exe"])

    def test_signing_adds_the_sign_command_and_an_unsigned_build_has_none(self):
        plain = b.installer_config(trial=False)
        self.assertNotIn("signCommand", plain["bundle"]["windows"])
        signed = b.installer_config(trial=True, sign=True)
        command = signed["bundle"]["windows"]["signCommand"]
        self.assertEqual(command["cmd"], sys.executable)
        self.assertTrue(pathlib.Path(command["args"][0]).is_file())
        self.assertEqual(pathlib.Path(command["args"][0]).name, "sign_windows.py")
        self.assertEqual(command["args"][-1], "%1")
        self.assertEqual(command["args"][1:3], ["--description", b.SIGN_DESCRIPTION])
        # Tauri offers pip's launchers too (it signs every unsigned program among the bundled files), so the script is told what to decline.
        self.assertEqual(command["args"][3:5], ["--leave-list", str(b.LEAVE_LIST)])
        self.assertEqual(signed["identifier"], b.TRIAL["identifier"])
        self.assertEqual(signed["bundle"]["resources"], b.resources())

    def test_the_list_the_sign_command_reads_names_every_file_left_unsigned(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(b, "LEAVE_LIST", pathlib.Path(d) / "signing" / "leave-unsigned.txt"):
            b.write_leave_list()
            entries = sign_windows.read_leave_list(b.LEAVE_LIST)
        self.assertEqual(set(entries), b.LEAVE_UNSIGNED)
        staged = b.PAYLOAD / "python" / "Lib" / "site-packages" / "pip" / "_vendor" / "distlib" / "t64.exe"
        self.assertTrue(sign_windows.left_on_purpose(staged, entries))
        self.assertFalse(sign_windows.left_on_purpose(b.PAYLOAD / "openstage-capture.exe", entries))


if __name__ == "__main__":
    unittest.main()
