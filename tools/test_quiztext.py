"""Tests for quiztext.py: how a keyboard shortcut and a which-word passage are read. The player reads them in TypeScript; both are run on the same tables
of cases (shortcut-cases.json, passage-cases.json), so they cannot quietly disagree."""

import json
import pathlib
import unittest

import quiztext

TOOLS = pathlib.Path(__file__).resolve().parent
SHORTCUTS = json.loads((TOOLS / "shortcut-cases.json").read_text(encoding="utf-8"))
PASSAGES = json.loads((TOOLS / "passage-cases.json").read_text(encoding="utf-8"))["cases"]


class Shortcuts(unittest.TestCase):
    def test_a_shortcut_typed_in_any_way_is_the_one_way_it_is_written(self):
        for typed, canonical in SHORTCUTS["canonical"]:
            with self.subTest(typed):
                self.assertEqual(quiztext.canonical_shortcut(typed), canonical)

    def test_what_is_not_a_shortcut_is_refused(self):
        for typed in SHORTCUTS["refused"]:
            with self.subTest(typed):
                self.assertIsNone(quiztext.parse_shortcut(typed))

    def test_the_canonical_form_reads_back_as_itself(self):
        for _, canonical in SHORTCUTS["canonical"]:
            with self.subTest(canonical):
                self.assertEqual(quiztext.canonical_shortcut(canonical), canonical)

    def test_the_combinations_a_browser_keeps_are_the_ones_the_player_lists(self):
        self.assertEqual(list(quiztext.BROWSER_KEEPS), SHORTCUTS["browserKeeps"])
        for keep in quiztext.BROWSER_KEEPS:
            self.assertEqual(quiztext.canonical_shortcut(keep), keep)

    def test_a_space_that_is_not_an_ordinary_space_is_still_a_space_as_it_is_in_the_player(self):
        self.assertEqual(quiztext.canonical_shortcut("Ctrl\u00a0+\u00a0S"), "Ctrl+S")
        self.assertEqual(quiztext.canonical_shortcut("\ufeffCtrl+S"), "Ctrl+S")
        self.assertEqual(quiztext.canonical_shortcut("alt+page\u00a0up"), "Alt+PageUp")

    def test_letters_that_only_look_like_letters_are_not_keys(self):
        # Python's case-insensitive match would take the long s and the Kelvin sign for s and k; the player does not.
        self.assertIsNone(quiztext.parse_shortcut("Ctrl+\u017f"))
        self.assertEqual(quiztext.canonical_shortcut("Ctrl+\u212a"), "Ctrl+K")


class Passages(unittest.TestCase):
    def test_a_passage_is_read_into_its_words_and_what_is_wrong_with_it(self):
        for case in PASSAGES:
            with self.subTest(case["source"]):
                read = quiztext.read_passage(case["source"])
                self.assertEqual([[t, r] for t, r in read["words"]], case["words"])
                self.assertEqual(read["problems"], case["problems"])

    def test_the_learner_reads_the_passage_whole_with_no_marks(self):
        self.assertEqual(quiztext.shown_passage("The dog [barked] loudly."), "The dog barked loudly.")
        self.assertEqual(quiztext.shown_passage('She said "[yes]", then  left.\nNext line [here].'), 'She said "yes", then  left.\nNext line here.')
        self.assertEqual(quiztext.shown_passage("A mark across [two words] here"), "A mark across two words here")

    def test_a_word_is_chosen_by_its_place(self):
        read = quiztext.read_passage('"[yes]", ok')
        self.assertEqual(read["pieces"], [("text", '"'), ("word", "yes", "w1"), ("text", '",'), ("text", " "), ("word", "ok", "w2")])

    def test_a_passage_of_more_than_the_most_words_is_too_long(self):
        words = " ".join(["w"] * quiztext.MAX_PASSAGE_WORDS)
        self.assertEqual(quiztext.read_passage(f"{words} [one] more")["problems"], ["too-many-words"])
        self.assertEqual(quiztext.read_passage(" ".join(["w"] * (quiztext.MAX_PASSAGE_WORDS - 1)) + " [one]")["problems"], [])


if __name__ == "__main__":
    unittest.main()
