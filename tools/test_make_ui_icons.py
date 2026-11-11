# SPDX-License-Identifier: Apache-2.0
"""Tests for the icons of the programs' own buttons and menus (design/icons.json, tools/make_ui_icons.py)."""
import contextlib
import io
import json
import pathlib
import re
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import make_ui_icons as m  # noqa: E402


class TheIconList(unittest.TestCase):
    def setUp(self):
        self.plan, self.lucide = m.load()

    def test_every_icon_named_is_in_the_lucide_set_author_ships(self):
        for product, rows in self.plan["products"].items():
            for row in rows:
                self.assertIn(row["icon"], self.lucide["icons"], f"{product}: {row['command']}")

    def test_author_and_recorder_both_have_their_commands_and_no_command_is_listed_twice_in_one_place(self):
        self.assertGreater(len(self.plan["products"]["author"]), 50)
        self.assertGreater(len(self.plan["products"]["recorder"]), 40)
        for product, rows in self.plan["products"].items():
            seen = [(r["area"], r["command"]) for r in rows]
            self.assertEqual(len(seen), len(set(seen)), product)

    def test_the_made_files_are_up_to_date(self):
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = m.main(["--check"])
        self.assertEqual(code, 0, buffer.getvalue())

    def test_the_editor_gets_exactly_authors_icons_with_the_licence(self):
        text = m.OUT_TS.read_text(encoding="utf-8")
        names = set(re.findall(r'^  "([a-z0-9-]+)": \[', text, re.M))
        self.assertEqual(names, {r["icon"] for r in self.plan["products"]["author"]})
        self.assertIn("ISC License", text)
        self.assertIn("do not edit by hand", text)

    def test_the_table_for_people_names_every_command_and_every_colour(self):
        text = m.OUT_MD.read_text(encoding="utf-8")
        for rows in self.plan["products"].values():
            for row in rows:
                self.assertIn(f"| {row['command']} | [{row['icon']}](https://lucide.dev/icons/{row['icon']})", text)
        for name, value in m.colours():
            self.assertIn(f"| `{name}` | `{value.upper()}` |", text)
        self.assertNotIn("—", text, "no em dash")

    def test_a_misspelt_icon_stops_the_run_and_names_the_command(self):
        broken = json.loads(m.ICONS_JSON.read_text(encoding="utf-8"))
        broken["products"]["author"][0]["icon"] = "not-an-icon"
        original = m.ICONS_JSON
        with tempfile.TemporaryDirectory() as folder:
            try:
                m.ICONS_JSON = pathlib.Path(folder) / "icons.json"
                m.ICONS_JSON.write_text(json.dumps(broken), encoding="utf-8")
                with self.assertRaises(m.IconError) as ctx:
                    m.load()
                self.assertIn("Undo uses not-an-icon", str(ctx.exception))
            finally:
                m.ICONS_JSON = original


class TheColours(unittest.TestCase):
    """The pairings DESIGN-GUIDE.md promises, measured from the style file itself, so a changed colour cannot quietly fail them."""

    @staticmethod
    def ratio(a, b):
        def lum(h):
            r, g, b_ = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
            f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4  # noqa: E731
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b_)
        hi, lo = sorted((lum(a), lum(b)), reverse=True)
        return (hi + 0.05) / (lo + 0.05)

    def test_words_and_controls_meet_their_contrast_on_the_backgrounds_they_sit_on(self):
        c = dict(m.colours())
        words = [("--os-on-shell", "--os-shell"), ("--os-on-shell-muted", "--os-shell"), ("--os-on-shell", "--os-shell-hover"),
                 ("--os-muted", "--os-surface"), ("--os-muted", "--os-page"), ("--os-muted", "--os-subtle"),
                 ("--os-surface", "--os-author-action"), ("--os-surface", "--os-author-action-hover"), ("--os-author-action", "--os-author-tint"),
                 ("--os-author-action", "--os-page"), ("--os-author-on-shell", "--os-shell"),
                 ("--os-surface", "--os-recorder-action"), ("--os-surface", "--os-recorder-action-hover"), ("--os-recorder-action", "--os-recorder-tint"),
                 ("--os-recorder-action", "--os-page"), ("--os-recorder-on-shell", "--os-shell"),
                 ("--os-success", "--os-success-tint"), ("--os-warning", "--os-warning-tint"), ("--os-danger", "--os-danger-tint"),
                 ("--os-surface", "--os-danger")]
        for fg, bg in words:
            self.assertGreaterEqual(self.ratio(c[fg], c[bg]), 4.5, f"{fg} on {bg}")
        for bg in ("--os-surface", "--os-page", "--os-subtle", "--os-author-tint"):
            self.assertGreaterEqual(self.ratio(c["--os-text"], c[bg]), 7, f"body words on {bg}")
        for bg in ("--os-surface", "--os-page", "--os-subtle"):
            self.assertGreaterEqual(self.ratio(c["--os-control-edge"], c[bg]), 3, f"control edge on {bg}")

    def test_the_logo_colours_are_too_faint_for_words_on_white_which_is_why_they_are_kept_for_the_logo(self):
        c = dict(m.colours())
        self.assertLess(self.ratio(c["--os-author-logo"], c["--os-surface"]), 3)
        self.assertLess(self.ratio(c["--os-recorder-logo"], c["--os-surface"]), 3)


if __name__ == "__main__":
    unittest.main()
