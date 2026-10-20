# SPDX-License-Identifier: Apache-2.0
"""Tests for reading a Windows program's import table."""
import os
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import check_imports as c  # noqa: E402

SYSTEM = pathlib.Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32"


@unittest.skipUnless((SYSTEM / "notepad.exe").is_file(), "needs Windows")
class Reading(unittest.TestCase):
    def test_a_windows_program_names_the_dlls_it_needs(self):
        names = c.imports(SYSTEM / "notepad.exe")
        self.assertIn("user32.dll", names)
        self.assertEqual(names, sorted(set(names)))

    def test_something_that_is_not_a_program_is_refused(self):
        with self.assertRaises(ValueError):
            c.imports(pathlib.Path(__file__))

    def test_the_command_line_says_which_program_asks_for_the_runtime(self):
        self.assertEqual(c.main([str(SYSTEM / "notepad.exe")]), 0 if not c.runtime_imports(c.imports(SYSTEM / "notepad.exe")) else 1)
        self.assertEqual(c.main([str(pathlib.Path(__file__))]), 2)


class Runtime(unittest.TestCase):
    def test_the_visual_cpp_runtime_is_told_from_the_universal_one(self):
        names = ["kernel32.dll", "vcruntime140.dll", "msvcp140.dll", "api-ms-win-crt-runtime-l1-1-0.dll", "ucrtbase.dll", "vcruntime140_1.dll", "concrt140.dll", "user32.dll"]
        self.assertEqual(c.runtime_imports(names), ["vcruntime140.dll", "msvcp140.dll", "vcruntime140_1.dll", "concrt140.dll"])


if __name__ == "__main__":
    unittest.main()
