"""Tests for the player's own words: the catalog in player-text.json, the way the player asks for them, and the validator's rules for a
course's own versions (playerText)."""

import json
import pathlib
import re
import shutil
import tempfile
import unittest

import validate

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOG = json.loads((ROOT / "tools" / "player-text.json").read_text(encoding="utf-8"))["keys"]
PLAYER_SRC = ROOT / "player" / "src"
PLACE = re.compile(r"\{([^{}]*)\}")


def player_sources():
    # The player, and the publisher, which writes a few phrases of the course's language into the package (the credits for icons and narration).
    return [p for p in sorted(PLAYER_SRC.glob("*.ts")) if not p.name.endswith(".test.ts") and p.name != "playertext.ts"] + [ROOT / "player" / "publish.ts"]


class Catalog(unittest.TestCase):
    def test_each_key_is_a_dotted_name_with_english_and_a_note(self):
        for key, entry in CATALOG.items():
            with self.subTest(key):
                self.assertRegex(key, r"^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$")
                self.assertIsInstance(entry["text"], str)
                self.assertTrue(entry["text"].strip(), "English is not empty")
                self.assertTrue(entry["note"].strip(), "a translator is told where it is used")
                self.assertEqual(set(entry), {"text", "note"})

    def test_places_are_plain_names_and_braces_are_balanced(self):
        for key, entry in CATALOG.items():
            with self.subTest(key):
                for name in PLACE.findall(entry["text"]):
                    self.assertRegex(name, r"^[A-Za-z0-9_]+$")
                self.assertEqual(entry["text"].count("{"), entry["text"].count("}"))
                self.assertEqual(entry["text"].count("{"), len(PLACE.findall(entry["text"])), "no brace outside a place")

    def test_a_form_for_one_always_comes_with_a_form_for_any_other_number(self):
        for key in CATALOG:
            if key.endswith(".one"):
                self.assertIn(key[: -len(".one")] + ".other", CATALOG, key)
            if key.endswith(".other"):
                self.assertIn(key[: -len(".other")] + ".one", CATALOG, key)
        for base in {k.rsplit(".", 1)[0] for k in CATALOG if k.endswith((".one", ".other"))}:
            self.assertIn("{n}", CATALOG[base + ".other"]["text"] + CATALOG[base + ".one"]["text"], f"{base} counts something, so a form says how many")

    def test_no_two_keys_say_the_same_thing_for_the_same_use_by_accident(self):
        # The same English may serve several places (Close), but then it is one key: two keys with the same words and the same note are a slip.
        seen = {}
        for key, entry in CATALOG.items():
            pair = (entry["text"], entry["note"])
            self.assertNotIn(pair, seen, f"{key} repeats {seen.get(pair)}")
            seen[pair] = key


class FileKinds(unittest.TestCase):
    def test_each_kind_of_file_has_its_words_in_the_catalog_as_the_download_list_gives_them(self):
        types = json.loads((ROOT / "tools" / "download-types.json").read_text(encoding="utf-8"))["types"]
        want = {f"download.type.{t['ext']}": t["label"] for t in types}
        have = {k: v["text"] for k, v in CATALOG.items() if k.startswith("download.type.")}
        self.assertEqual(have, want, "add a kind of file to tools/download-types.json and run the catalog script to give it a key")


class PlayerAsksForWhatExists(unittest.TestCase):
    """The player asks t("key") and tn("key", n): a key in the code that is not in the catalog fails to compile, and this is the other way round."""

    def calls(self):
        used = {}
        for path in player_sources():
            text = path.read_text(encoding="utf-8")
            for m in re.finditer(r'(?<![\w.])(t|tn)\(\s*"([^"]+)"', text):
                used.setdefault(m.group(2) if m.group(1) == "t" else m.group(2), set()).add((path.name, m.group(1)))
        return used

    def test_every_key_the_player_asks_for_is_in_the_catalog(self):
        for key, where in self.calls().items():
            names = {w[0] for w in where}
            if any(kind == "tn" for _, kind in where):
                self.assertIn(f"{key}.one", CATALOG, f"{key} in {names}")
                self.assertIn(f"{key}.other", CATALOG, f"{key} in {names}")
            else:
                self.assertIn(key, CATALOG, f"{key} in {names}")

    def test_every_key_in_the_catalog_is_asked_for_somewhere(self):
        asked = set()
        for key, where in self.calls().items():
            if any(kind == "tn" for _, kind in where):
                asked |= {f"{key}.one", f"{key}.other"}
            else:
                asked.add(key)
        # The kinds of file a learner can download are built from tools/download-types.json (see below), so the player asks for them by that name.
        asked |= {k for k in CATALOG if k.startswith("download.type.")}
        dead = sorted(set(CATALOG) - asked)
        self.assertEqual(dead, [], "keys nothing in the player uses: take them out, or use them")

    def test_the_player_never_asks_for_a_key_it_has_built_up_as_it_goes(self):
        # A key made from pieces cannot be checked above, nor found by a translator reading the code. A list of literal keys is clear.
        for path in player_sources():
            for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                for m in re.finditer(r'(?<![\w.])(?:t|tn)\(\s*([^"\s)][^,)]*)', line):
                    if m.group(1).startswith("`"):
                        self.fail(f"{path.name}:{n} builds a key from pieces: {line.strip()}")

    def test_the_places_a_phrase_is_given_are_the_places_it_has(self):
        for path in player_sources():
            text = path.read_text(encoding="utf-8")
            for m in re.finditer(r'(?<![\w.])(t|tn)\(\s*"([^"]+)"\s*,\s*\{([^{}]*)\}', text):
                kind, key, args = m.groups()
                given = {a.split(":")[0].strip() for a in re.split(r",(?![^()]*\))", args) if a.strip()}
                given = {g for g in given if re.fullmatch(r"[A-Za-z0-9_]+", g)}
                forms = [key] if kind == "t" else [f"{key}.one", f"{key}.other"]
                for form in forms:
                    have = set(PLACE.findall(CATALOG[form]["text"]))
                    if kind == "tn":
                        given |= {"n"}
                    self.assertTrue(have <= given, f"{path.name}: {form} has places {sorted(have)} but is given {sorted(given)}")


class ValidatorRules(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = pathlib.Path(self.tmp.name) / "p.osproj"
        shutil.copytree(ROOT / "examples" / "minimal.osproj", self.dir, ignore=shutil.ignore_patterns(".cache"))

    def check(self, table):
        pj = self.dir / "project.json"
        project = json.loads(pj.read_text(encoding="utf-8"))
        if table is None:
            project.pop("playerText", None)
        else:
            project["playerText"] = table
        pj.write_text(json.dumps(project, indent=2), encoding="utf-8")
        return [(f.rule, f.severity, f.object_id) for f in validate.validate_project(self.dir) if f.rule.startswith("player-text") or f.rule.startswith("schema")]

    def test_no_playerText_and_a_good_one_are_both_fine(self):
        self.assertEqual(self.check(None), [])
        self.assertEqual(self.check({}), [])
        self.assertEqual(self.check({"nav.next": "Suivant", "nav.slideOf": "Diapositive {n} sur {total}"}), [])
        self.assertEqual(self.check({"nav.slideOf": "{total} au total, la {n}e"}), [], "the places may come in any order")

    def test_a_key_the_player_does_not_have_is_a_warning(self):
        self.assertEqual(self.check({"nav.nxt": "Suivant"}), [("player-text-unknown-key", "warning", "nav.nxt")])

    def test_an_empty_phrase_is_an_error(self):
        self.assertEqual(self.check({"nav.next": "   "}), [("player-text-empty", "error", "nav.next")])

    def test_a_phrase_that_loses_changes_or_adds_a_place_is_an_error(self):
        for bad in ("Diapositive {n}", "Diapositive {n} sur {all}", "Diapositive {n} sur {total} ({extra})", "Diapositive sur"):
            with self.subTest(bad):
                self.assertEqual(self.check({"nav.slideOf": bad}), [("player-text-places", "error", "nav.slideOf")])
        self.assertEqual(self.check({"nav.next": "Suivant {n}"}), [("player-text-places", "error", "nav.next")], "a key with no places takes none")

    def test_the_schema_refuses_what_is_not_a_table_of_phrases(self):
        for bad in ("Suivant", ["a"], {"nav.next": 5}, {"nav.next": "x" * 501}):
            with self.subTest(bad):
                findings = self.check(bad)
                self.assertTrue(findings and all(f[1] == "error" for f in findings), findings)


if __name__ == "__main__":
    unittest.main(verbosity=1)
