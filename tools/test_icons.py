"""Tests for the icon list the editor offers. Every icon in it has to be something the format accepts, or a project that uses it would not validate.

Run with:  python tools/test_icons.py
"""
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import validate  # noqa: E402
from jsonschema import Draft202012Validator  # noqa: E402
from referencing import Registry, Resource  # noqa: E402

CATALOGUE = validate.ROOT / "editor" / "web" / "icons" / "lucide.json"


def icon_validator():
    schemas = {name: json.loads((validate.SCHEMA_DIR / f"{name}.schema.json").read_text(encoding="utf-8")) for name in ("project", "slide", "object", "theme", "assets")}
    registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas.values())
    return Draft202012Validator({"$ref": schemas["object"]["$id"] + "#/$defs/contentIcon"}, registry=registry)


class IconList(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(CATALOGUE.read_text(encoding="utf-8"))
        cls.check = icon_validator()

    def test_there_is_a_good_number_of_icons_and_they_say_where_they_came_from(self):
        self.assertEqual(self.data["set"], "lucide")
        self.assertGreater(len(self.data["icons"]), 1000)
        self.assertIn("ISC License", self.data["licence"])
        self.assertIn("Lucide Icons and Contributors", self.data["licence"])
        self.assertTrue(self.data["version"])

    def test_the_licence_is_the_one_kept_with_the_project(self):
        kept = (validate.ROOT / "third-party" / "lucide-LICENSE.txt").read_text(encoding="utf-8")
        self.assertEqual(self.data["licence"].replace("\r\n", "\n"), kept.replace("\r\n", "\n"))

    def test_every_icon_is_something_the_format_accepts(self):
        bad = []
        for name, icon in self.data["icons"].items():
            content = {"set": "lucide", "name": name, "shapes": icon["s"]}
            errors = list(self.check.iter_errors(content))
            if errors:
                bad.append((name, errors[0].message[:80]))
        self.assertEqual(bad, [])

    def test_every_icon_has_search_words_that_are_plain_lower_case_text(self):
        for name, icon in self.data["icons"].items():
            self.assertIsInstance(icon["t"], list, name)
            for word in icon["t"]:
                self.assertEqual(word, word.lower(), name)

    def test_the_icons_named_in_the_editor_exist(self):
        for name in ("arrow-right", "arrow-left", "rotate-ccw", "check", "x", "info", "circle-question-mark", "lightbulb", "play", "book-open"):
            self.assertIn(name, self.data["icons"], name)


if __name__ == "__main__":
    unittest.main(verbosity=1)
