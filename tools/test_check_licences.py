# SPDX-License-Identifier: Apache-2.0
"""Tests for the licence checker's reading of licence expressions and of Python packages."""
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import check_licences as c  # noqa: E402


class Expressions(unittest.TestCase):
    def test_a_permissive_licence_is_fine(self):
        for expr in ["MIT", "Apache-2.0", "MIT OR Apache-2.0", "Apache-2.0 OR MIT", "MIT/Apache-2.0", "Unicode-3.0", "CC0-1.0 OR MIT-0 OR Apache-2.0"]:
            self.assertTrue(c.acceptable(expr), expr)

    def test_or_needs_one_allowed_side_and_and_needs_both(self):
        self.assertTrue(c.acceptable("GPL-3.0-only OR MIT"))
        self.assertFalse(c.acceptable("GPL-3.0-only AND MIT"))
        self.assertTrue(c.acceptable("(MIT OR Apache-2.0) AND Unicode-3.0"))
        self.assertFalse(c.acceptable("(GPL-2.0 OR LGPL-3.0) AND MIT"))

    def test_a_with_exception_is_read_as_the_licence_it_modifies(self):
        self.assertTrue(c.acceptable("Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT"))
        self.assertTrue(c.acceptable("Apache-2.0 WITH LLVM-exception"))

    def test_copyleft_unknown_and_empty_are_not_fine(self):
        for expr in ["GPL-3.0-or-later", "LGPL-2.1", "AGPL-3.0", "SSPL-1.0", "", "SEE LICENSE IN LICENSE", "Proprietary"]:
            self.assertFalse(c.acceptable(expr), expr)

    def test_mpl_is_fine_only_for_the_crates_that_have_been_looked_at(self):
        self.assertTrue(c.acceptable("MPL-2.0", "selectors"))
        self.assertTrue(c.acceptable("MPL-2.0", "option-ext"))
        self.assertFalse(c.acceptable("MPL-2.0", "some-new-crate"))
        self.assertFalse(c.acceptable("MPL-2.0"))
        self.assertTrue(c.acceptable("MPL-2.0 OR MIT", "some-new-crate"), "an alternative that is permissive is enough")

    def test_the_checker_names_what_it_found_wrong(self):
        rust = [{"name": "good", "version": "1", "license": "MIT", "dir": pathlib.Path(".")}, {"name": "bad", "version": "2", "license": "GPL-3.0", "dir": pathlib.Path(".")}, {"name": "blank", "version": "3", "license": "", "dir": pathlib.Path(".")}]
        self.assertEqual(c.check(rust, []), ["bad 2: GPL-3.0", "blank 3: no licence stated"])


class PythonPackages(unittest.TestCase):
    def _package(self, folder, name, *headers):
        info = pathlib.Path(folder) / f"{name}-1.0.dist-info"
        info.mkdir(parents=True)
        lines = ["Metadata-Version: 2.1", f"Name: {name}", "Version: 1.0", *headers, ""]
        (info / "METADATA").write_text(chr(10).join(lines), encoding="utf-8")
        (info / "LICENSE").write_text("licence of " + name, encoding="utf-8")

    def test_the_licence_is_read_from_an_expression_or_a_classifier(self):
        with tempfile.TemporaryDirectory() as d:
            self._package(d, "expr", "License-Expression: MIT")
            self._package(d, "classified", "Classifier: License :: OSI Approved :: Apache Software License")
            self._package(d, "both", "Classifier: License :: OSI Approved :: MIT License", "Classifier: License :: OSI Approved :: BSD License")
            self._package(d, "none", "Summary: nothing said")
            found = {p["name"]: p["license"] for p in c.python_packages(d)}
            self.assertEqual(found, {"expr": "MIT", "classified": "Apache-2.0", "both": "MIT OR BSD-3-Clause", "none": ""})
            self.assertEqual(c.check([], [], c.python_packages(d)), ["none 1.0: no licence stated"])

    def test_certifi_is_allowed_to_be_mpl_and_nothing_else_is(self):
        with tempfile.TemporaryDirectory() as d:
            self._package(d, "certifi", "License-Expression: MPL-2.0")
            self._package(d, "other", "License-Expression: MPL-2.0")
            self.assertEqual(c.check([], [], c.python_packages(d)), ["other 1.0: MPL-2.0"])


if __name__ == "__main__":
    unittest.main()
