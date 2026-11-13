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
        # The setup carries Microsoft's signed WebView2 bootstrapper rather than fetching it while it installs.
        self.assertEqual(conf["bundle"]["windows"]["webviewInstallMode"], {"type": "embedBootstrapper"})
        # An update replaces the two Pythons whole, so nothing of an earlier version's Python is left mixed in.
        self.assertEqual(conf["bundle"]["windows"]["nsis"]["installerHooks"], "installer/hooks.nsh")
        hooks = (b.TAURI / "installer" / "hooks.nsh").read_text(encoding="utf-8")
        self.assertIn(r'RMDir /r "$INSTDIR\python"', hooks)
        self.assertIn(r'RMDir /r "$INSTDIR\python-narration"', hooks)
        # Tauri puts its own byte order mark on a custom language file; a second one makes the installer maker fail ("Invalid command").
        self.assertNotEqual((b.TAURI / "installer" / "English.nsh").read_bytes()[:3], b"\xef\xbb\xbf")

    def test_the_trial_has_its_own_name_and_identifier_and_the_real_one_is_not_touched(self):
        import json
        self.assertNotEqual(b.TRIAL["identifier"], json.loads((b.TAURI / "tauri.conf.json").read_text(encoding="utf-8"))["identifier"])
        self.assertTrue(b.TRIAL["identifier"].startswith("com.openstageauthor.editor."))

    def test_nothing_from_the_gpl_family_is_named_in_what_goes_in(self):
        # The narration engine is installed on the author's own computer afterwards (docs/decisions/0004-packaging-and-narration.md); none of it travels in the installer.
        packages = (b.PYTHON_REQUIREMENTS.read_text(encoding="utf-8") + b.NARRATION_PYTHON_REQUIREMENTS.read_text(encoding="utf-8")).lower()
        for word in ("espeak", "phonemizer", "piper", "kokoro", "torch", "misaki"):
            self.assertNotIn(word, packages, word)

    def test_every_python_package_that_goes_in_is_locked_with_its_hash(self):
        for path, python in ((b.PYTHON_REQUIREMENTS, b.PYTHON_VERSION), (b.NARRATION_PYTHON_REQUIREMENTS, b.NARRATION_PYTHON_VERSION)):
            text = path.read_text(encoding="utf-8")
            self.assertIn(f"# Locked for Python {python} ", text, f"{path.name} was locked for the Python it goes into")
            lines = [l for l in text.splitlines() if l.strip() and not l.startswith("#")]
            self.assertTrue(lines, path.name)
            for line in lines:
                self.assertRegex(line, r"^[A-Za-z0-9_.-]+==\S+ --hash=sha256:[0-9a-f]{64}$", path.name)
        self.assertIn("jsonschema==", b.PYTHON_REQUIREMENTS.read_text(encoding="utf-8"))
        self.assertIn("pip==", b.NARRATION_PYTHON_REQUIREMENTS.read_text(encoding="utf-8"))
        self.assertNotIn("pip==", b.PYTHON_REQUIREMENTS.read_text(encoding="utf-8"), "the tools' Python installs nothing, so it carries no pip")

    def test_both_pythons_are_checked_with_sha256_and_are_versions_python_org_looks_after(self):
        for value in (b.PYTHON_SHA256, b.NARRATION_PYTHON_SHA256):
            self.assertRegex(value, r"^[0-9a-f]{64}$")
        self.assertEqual(b.PYTHON_VERSION.split(".")[:2], ["3", "14"])
        # Kokoro and misaki say they need a Python older than 3.13.
        self.assertEqual(b.NARRATION_PYTHON_VERSION.split(".")[:2], ["3", "12"])
        self.assertTrue(b.PYTHON_URL.startswith("https://www.python.org/ftp/python/") and b.NARRATION_PYTHON_URL.startswith("https://www.python.org/ftp/python/"))
        major, minor, patch = (int(n) for n in b.NODE_VERSION.split("."))
        self.assertGreaterEqual((major, minor, patch), (24, 22, 3))

    def test_a_download_that_does_not_match_its_checksum_is_deleted_and_stops_the_build(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(b, "CACHE", pathlib.Path(d)):
            bad = pathlib.Path(d) / "python-9.9.9-embed-amd64.zip"
            bad.write_bytes(b"not python")
            with self.assertRaises(SystemExit):
                b.cached_embed("9.9.9", "https://www.python.org/x", "0" * 64)
            self.assertFalse(bad.exists())
            bad.write_bytes(b"abc")
            with self.assertRaises(SystemExit):
                b.cached_embed("9.9.9", "https://www.python.org/x", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "0" * 32)
            self.assertFalse(bad.exists(), "the MD5 is checked too where it is given")
            bad.write_bytes(b"abc")
            self.assertEqual(b.cached_embed("9.9.9", "https://www.python.org/x", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "900150983cd24fb0d6963f7d28e17f72"), bad)

    def test_the_narration_pythons_folder_is_the_one_the_editor_looks_for(self):
        engine = (b.TAURI / "src" / "engine.rs").read_text(encoding="utf-8")
        self.assertIn('pub const PYTHON_FOLDER: &str = "python-narration";', engine)
        self.assertTrue(b.SITECUSTOMIZE.is_file())


class Paths(unittest.TestCase):
    def test_rust_builds_keep_their_own_flags_and_remap_the_users_the_tools_and_the_repositorys_folders(self):
        flags = b.remap_rustflags(b.TAURI)
        # The crate's own flags (from .cargo/config.toml) would be dropped by an environment setting, so they are carried over.
        self.assertEqual(flags[:2], ["-C", "target-feature=+crt-static"])
        remaps = [f for f in flags if f.startswith("--remap-path-prefix=")]
        self.assertEqual(remaps[0], f"--remap-path-prefix={pathlib.Path.home()}=/home", "the broadest first: rustc takes the last that matches")
        self.assertEqual(remaps[-1], f"--remap-path-prefix={b.ROOT}=/openstage")
        self.assertTrue(any(f.endswith("=/cargo") for f in remaps))
        env = b.rust_environment(b.TAURI)
        self.assertEqual(env["CARGO_ENCODED_RUSTFLAGS"].split("\x1f"), flags)
        self.assertNotIn("RUSTFLAGS", env)

    def test_a_program_that_names_the_user_folder_is_found_in_either_slash_or_as_utf16(self):
        home = str(pathlib.Path.home())
        with tempfile.TemporaryDirectory() as d:
            clean, plain, wide, forward = (pathlib.Path(d) / n for n in ("clean.exe", "plain.exe", "wide.dll", "forward.pyd"))
            clean.write_bytes(b"MZ /cargo/registry/src/x.rs /openstage/editor")
            plain.write_bytes(b"MZ " + home.upper().encode() + b"\\.cargo\\x.rs")
            wide.write_bytes(b"MZ " + home.encode("utf-16-le"))
            forward.write_bytes(b"MZ " + home.replace("\\", "/").encode())
            self.assertEqual(sorted(p.name for p, _ in b.personal_paths([clean, plain, wide, forward])), ["forward.pyd", "plain.exe", "wide.dll"])

    def test_the_recorder_is_built_here_into_a_folder_of_the_installer_builds_own(self):
        self.assertTrue((b.CAPTURE / "Cargo.toml").is_file())
        self.assertEqual(b.CAPTURE_TARGET.relative_to(b.DIST).parts[0], "installer-build")

class Signing(unittest.TestCase):
    def test_only_pips_launcher_templates_are_left_unsigned_on_purpose(self):
        site = "python-narration/Lib/site-packages/"
        templates = {site + "pip/_vendor/distlib/" + n for n in ("t32.exe", "t64.exe", "t64-arm.exe", "w32.exe", "w64.exe", "w64-arm.exe")}
        self.assertEqual(b.LEAVE_UNSIGNED, templates)
        # The wrappers pip made while staging name the build computer's own Python, so they are taken out (stage_python).
        self.assertIn('shutil.rmtree(site / "bin"', (b.ROOT / "tools" / "build_installer.py").read_text(encoding="utf-8"))

    def test_the_templates_stay_because_the_narration_install_uses_pip(self):
        # pip copies a launcher template for each package with commands of its own that it installs. If the narration install ever stops using pip, the
        # reason for keeping the templates (LEAVE_UNSIGNED) should be looked at again.
        engine = (b.TAURI / "src" / "engine.rs").read_text(encoding="utf-8")
        self.assertIn('"-m", "pip", "install"', engine)
        self.assertIn('"--target"', engine)

    def test_a_file_left_unsigned_is_found_by_its_exact_place_also_one_folder_deeper(self):
        kept = "python-narration/Lib/site-packages/pip/_vendor/distlib/t64.exe"
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
        staged = b.PAYLOAD / "python-narration" / "Lib" / "site-packages" / "pip" / "_vendor" / "distlib" / "t64.exe"
        self.assertTrue(sign_windows.left_on_purpose(staged, entries))
        self.assertFalse(sign_windows.left_on_purpose(b.PAYLOAD / "openstage-capture.exe", entries))


if __name__ == "__main__":
    unittest.main()
