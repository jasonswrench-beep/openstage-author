"""Tests for the to-do page made from ROADMAP.md. Run with:  python tools/test_todo.py"""
import pathlib
import re
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import make_todo  # noqa: E402

SAMPLE = """# Roadmap

## What is left (updated 2026-10-14)

The list of everything not done yet.

### Try it

Built, not yet seen.

- [ ] **The AI features.** Add a key, then `make` a picture.
- [x] **Looks** are done. They use <b>angle brackets</b> & an ampersand.
- plain bullet **bold**

### Held

- [ ] **The AI features.** A second item with the same lead.

## Phase 1

- [ ] **Not part of it.**
"""


class Parsing(unittest.TestCase):
    def test_the_section_stops_at_the_next_big_heading(self):
        parsed = make_todo.parse_roadmap(SAMPLE)
        self.assertEqual(parsed["title"], "What is left (updated 2026-10-14)")
        self.assertEqual([s["title"] for s in parsed["sections"]], ["Try it", "Held"])
        self.assertEqual(parsed["intro"], ["The list of everything not done yet."])
        self.assertNotIn("not-part-of-it", [i["key"] for s in parsed["sections"] for i in s["items"]])

    def test_items_bullets_and_notes_are_told_apart(self):
        first = make_todo.parse_roadmap(SAMPLE)["sections"][0]
        self.assertEqual(first["notes"], ["Built, not yet seen."])
        self.assertEqual([i["done"] for i in first["items"]], [False, True])
        self.assertEqual(first["bullets"], ["plain bullet <strong>bold</strong>"])

    def test_markdown_is_kept_and_everything_else_is_plain_words(self):
        item = make_todo.parse_roadmap(SAMPLE)["sections"][0]["items"][1]
        self.assertEqual(item["html"], "<strong>Looks</strong> are done. They use &lt;b&gt;angle brackets&lt;/b&gt; &amp; an ampersand.")
        self.assertEqual(make_todo.inline("a `x < y` b"), "a <code>x &lt; y</code> b")
        self.assertNotIn("<script", make_todo.inline("<script>alert(1)</script>"))

    def test_an_item_keeps_its_name_when_the_words_after_the_lead_change(self):
        a = make_todo.parse_roadmap(SAMPLE)["sections"][0]["items"][0]["key"]
        edited = SAMPLE.replace("Add a key, then `make` a picture.", "Something else entirely.")
        self.assertEqual(make_todo.parse_roadmap(edited)["sections"][0]["items"][0]["key"], a)
        self.assertEqual(a, "the-ai-features")

    def test_two_items_with_one_lead_get_two_names(self):
        keys = [i["key"] for s in make_todo.parse_roadmap(SAMPLE)["sections"] for i in s["items"]]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertIn("the-ai-features-2", keys)

    def test_a_roadmap_without_the_section_is_refused(self):
        with self.assertRaises(ValueError):
            make_todo.parse_roadmap("# Roadmap\n\n## Phase 1\n")

    def test_windows_line_endings_are_fine(self):
        self.assertEqual(len(make_todo.parse_roadmap(SAMPLE.replace("\n", "\r\n"))["sections"]), 2)


class Page(unittest.TestCase):
    def test_every_item_has_a_box_with_its_own_label(self):
        page = make_todo.build(SAMPLE)
        boxes = re.findall(r'<input type="checkbox" id="(t-[^"]+)" data-key="([^"]+)" data-done="(true|false)">', page)
        self.assertEqual([b[1] for b in boxes], ["the-ai-features", "looks", "the-ai-features-2"])
        self.assertEqual([b[2] for b in boxes], ["false", "true", "false"], "an item the roadmap marks done starts ticked")
        for box_id, _, _ in boxes:
            self.assertIn(f'<label for="{box_id}">', page)

    def test_the_page_is_self_contained_and_says_what_it_is(self):
        page = make_todo.build(SAMPLE)
        self.assertIn("<title>OpenStage Author: what is left</title>", page)
        self.assertNotRegex(page, r'(src|href)="https?://', "no outside file")
        self.assertIn('role="status"', page)
        self.assertIn("Hide the ticked items", page)
        self.assertNotIn("__", page.replace("__proto__", ""), "no template slot left unfilled")

    def test_text_from_the_roadmap_cannot_add_markup(self):
        page = make_todo.build(SAMPLE.replace("Add a key", "<img src=x onerror=alert(1)>"))
        self.assertNotIn("<img", page)
        self.assertIn("&lt;img", page)

    def test_the_real_roadmap_makes_a_page(self):
        parsed = make_todo.parse_roadmap((make_todo.ROADMAP).read_text(encoding="utf-8"))
        items = [i for s in parsed["sections"] for i in s["items"]]
        self.assertGreaterEqual(len(parsed["sections"]), 3)
        self.assertGreaterEqual(len(items), 10)
        self.assertEqual(len({i["key"] for i in items}), len(items))
        page = make_todo.build(make_todo.ROADMAP.read_text(encoding="utf-8"))
        self.assertEqual(page.count('type="checkbox" id="t-'), len(items))

    def test_the_batch_file_runs_the_tool_and_opens_a_web_address(self):
        bat = (pathlib.Path(__file__).resolve().parent.parent / "TO-DO.bat").read_bytes()
        self.assertIn(b"tools\\make_todo.py", bat)
        self.assertIn(b'start "" "http://127.0.0.1:8766/"', bat, "a web address, because a .html file may open in a text editor")
        self.assertIn(b"\r\n", bat)


if __name__ == "__main__":
    unittest.main(verbosity=1)
