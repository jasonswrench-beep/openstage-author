# SPDX-License-Identifier: Apache-2.0
"""Tests for the licence checker's reading of licence expressions."""
import pathlib
import sys
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


if __name__ == "__main__":
    unittest.main()
