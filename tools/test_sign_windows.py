# SPDX-License-Identifier: Apache-2.0
"""Tests for tools/sign_windows.py that ask Azure nothing and sign nothing."""
import contextlib
import io
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import sign_windows as s  # noqa: E402

ACCOUNT = {"OPENSTAGE_SIGN_ENDPOINT": "https://eus.codesigning.azure.net/", "OPENSTAGE_SIGN_ACCOUNT": "Account", "OPENSTAGE_SIGN_PROFILE": "Profile"}


class Settings(unittest.TestCase):
    def test_missing_account_details_are_named(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(s.SignError) as e:
                s.settings()
        for name in ACCOUNT:
            self.assertIn(name, str(e.exception))

    def test_the_details_become_the_fields_microsofts_library_reads(self):
        with mock.patch.dict(os.environ, ACCOUNT, clear=True):
            self.assertEqual(s.settings(), {"Endpoint": "https://eus.codesigning.azure.net/", "CodeSigningAccountName": "Account", "CertificateProfileName": "Profile"})

    def test_an_endpoint_that_is_not_a_signing_region_is_refused(self):
        # A wrong address only fails later, at signing, with a 403 and a misleading message from signtool.
        for wrong in ("http://eus.codesigning.azure.net/", "https://example.com/", "eus.codesigning.azure.net", "https://eus.codesigning.azure.net/x"):
            with mock.patch.dict(os.environ, dict(ACCOUNT, OPENSTAGE_SIGN_ENDPOINT=wrong), clear=True):
                with self.assertRaises(s.SignError, msg=wrong):
                    s.settings()


class Signtool(unittest.TestCase):
    def test_the_sdk_version_is_read_from_the_folder(self):
        self.assertEqual(s.sdk_version(r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe"), (10, 0, 26100, 0))
        self.assertIsNone(s.sdk_version(r"C:\tools\signtool.exe"))

    def test_only_a_signtool_microsofts_library_works_with_is_used(self):
        self.assertTrue(s.usable_sdk((10, 0, 26100, 0)))
        self.assertTrue(s.usable_sdk((10, 0, 22621, 0)))
        self.assertFalse(s.usable_sdk((10, 0, 17134, 0)))  # on the build computer too, and too old
        self.assertFalse(s.usable_sdk((10, 0, 20348, 0)))  # named by Microsoft as not working with the library
        self.assertFalse(s.usable_sdk(None))

    def test_every_signature_is_sha256_and_timestamped_by_microsofts_service(self):
        command = s.sign_command("signtool.exe", "dlib.dll", "metadata.json", "file.exe", "OpenStage Author")
        joined = " ".join(command)
        self.assertIn("/fd SHA256", joined)
        self.assertIn("/tr http://timestamp.acs.microsoft.com /td SHA256", joined)
        self.assertIn("/dlib dlib.dll /dmdf metadata.json", joined)
        self.assertEqual(command[command.index("/d") + 1], "OpenStage Author")
        self.assertEqual(command[-1], "file.exe")
        self.assertEqual(s.timestamp_command("signtool.exe", "file.exe"),
                         ["signtool.exe", "timestamp", "/tr", "http://timestamp.acs.microsoft.com", "/td", "SHA256", "file.exe"])


class Problems(unittest.TestCase):
    def test_a_file_counts_as_signed_only_when_valid_and_timestamped(self):
        good = {"status": "Valid", "signer": "Jason Wrench", "timestamped": True}
        self.assertIsNone(s.problem(good))
        self.assertIsNone(s.problem(good, "Jason Wrench"))
        self.assertEqual(s.problem(dict(good, status="NotSigned", signer=None, timestamped=False)), "not signed")
        self.assertIn("not valid (HashMismatch)", s.problem(dict(good, status="HashMismatch")))
        self.assertIn("not timestamped", s.problem(dict(good, timestamped=False)))
        self.assertIn("not 'Jason Wrench'", s.problem(dict(good, signer="Someone Else"), "Jason Wrench"))


class DryRun(unittest.TestCase):
    def test_a_dry_run_writes_the_account_file_prints_the_command_and_signs_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            (d / "signtool.exe").write_bytes(b"")
            (d / "Azure.CodeSigning.Dlib.dll").write_bytes(b"")
            target = d / "program with a space.exe"
            target.write_bytes(b"MZ")
            env = dict(ACCOUNT, OPENSTAGE_SIGN_DRY_RUN="1", OPENSTAGE_SIGNTOOL=str(d / "signtool.exe"), OPENSTAGE_SIGN_DLIB=str(d / "Azure.CodeSigning.Dlib.dll"))
            out = io.StringIO()
            with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(s, "METADATA", d / "signing" / "metadata.json"), contextlib.redirect_stdout(out):
                code = s.main(["--description", "OpenStage Author", str(target)])
            self.assertEqual(code, 0, out.getvalue())
            self.assertIn("would run:", out.getvalue())
            self.assertIn('"' + str(target) + '"', out.getvalue())
            self.assertIn("signed (dry run)", out.getvalue())
            self.assertIn('"CodeSigningAccountName": "Account"', (d / "signing" / "metadata.json").read_text(encoding="utf-8"))
            self.assertEqual(target.read_bytes(), b"MZ")

    def test_a_file_in_the_leave_list_is_declined_and_the_rest_are_signed(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            (d / "signtool.exe").write_bytes(b"")
            (d / "Azure.CodeSigning.Dlib.dll").write_bytes(b"")
            kept = d / "python" / "Lib" / "site-packages" / "pip" / "_vendor" / "distlib" / "t64.exe"
            kept.parent.mkdir(parents=True)
            kept.write_bytes(b"MZ")
            ours = d / "speech" / "t64.exe"  # the same file name in another folder is not in the list
            ours.parent.mkdir()
            ours.write_bytes(b"MZ")
            listing = d / "leave.txt"
            listing.write_text("# comment\n\npython\\Lib\\site-packages\\pip\\_vendor\\distlib\\t64.exe\n", encoding="utf-8")
            env = dict(ACCOUNT, OPENSTAGE_SIGN_DRY_RUN="1", OPENSTAGE_SIGNTOOL=str(d / "signtool.exe"), OPENSTAGE_SIGN_DLIB=str(d / "Azure.CodeSigning.Dlib.dll"))
            out = io.StringIO()
            with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(s, "METADATA", d / "signing" / "metadata.json"), contextlib.redirect_stdout(out):
                code = s.main(["--leave-list", str(listing), str(kept), str(ours)])
        self.assertEqual(code, 0, out.getvalue())
        self.assertIn("t64.exe: left unsigned on purpose", out.getvalue())
        self.assertEqual(out.getvalue().count("would run:"), 1)
        self.assertIn(str(ours), out.getvalue())

    def test_a_leave_list_with_only_listed_files_asks_for_nothing(self):
        # Tauri calls the script once per file; for a listed file it must succeed without needing the account details or signtool.
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            kept = d / "bin" / "pip.exe"
            kept.parent.mkdir()
            kept.write_bytes(b"MZ")
            listing = d / "leave.txt"
            listing.write_text("bin/pip.exe\n", encoding="utf-8")
            out = io.StringIO()
            with mock.patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(out):
                self.assertEqual(s.main(["--leave-list", str(listing), str(kept)]), 0)
        self.assertIn("left unsigned on purpose", out.getvalue())

    def test_a_missing_file_stops_before_anything_is_run(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(s.main([str(pathlib.Path(tempfile.gettempdir()) / "no-such-program-here.exe")]), 1)
        self.assertIn("There is no file", out.getvalue())


@unittest.skipUnless(os.name == "nt", "Windows reads the signatures")
class RealSignatures(unittest.TestCase):
    def test_windows_reads_the_files_and_a_file_just_written_does_not_count_as_signed(self):
        # The Python running this is signed by its maker. A file just written is not (Windows calls a file that is not a whole program
        # "UnknownError" rather than "NotSigned"; either way it must not count).
        with tempfile.TemporaryDirectory() as d:
            plain = pathlib.Path(d) / "plain.dll"
            plain.write_bytes(b"MZ" + b"\0" * 64)
            found = s.signatures([sys.executable, plain])
        self.assertEqual(len(found), 2)
        self.assertEqual(found[0]["path"], str(pathlib.Path(sys.executable).resolve()))
        self.assertIsNotNone(s.problem(found[1]))
        self.assertFalse(found[1]["timestamped"])


if __name__ == "__main__":
    unittest.main()
