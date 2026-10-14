"""Tests for caption building. These need no speech model: they feed in the word timings
Kokoro would report. Run with:  python tools/test_narrate.py
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import narrate  # noqa: E402

SCRIPT = "Welcome to the course. It starts here, then it goes on! Is that clear?"


def fake_tokens(script, per_word=0.4, lead=0.25):
    """Kokoro-style tokens: words carry times, punctuation has none."""
    tokens, t = [], lead
    for m in __import__("re").finditer(r"\w+|[^\w\s]", script):
        end = m.end()
        ws = " " if end < len(script) and script[end].isspace() else ""
        if m.group(0).isalnum() or m.group(0).replace("'", "").isalnum():
            tokens.append((m.group(0), ws, t, t + per_word))
            t += per_word
        else:
            tokens.append((m.group(0), ws, None, None))
    return tokens, t


class Captions(unittest.TestCase):
    def cues(self, script=SCRIPT):
        tokens, duration = fake_tokens(script)
        text, spans = narrate.words_with_offsets(tokens)
        self.assertEqual(text.strip(), script)
        return narrate.build_cues(script, spans, duration)

    def test_one_cue_per_sentence(self):
        cues, exact = self.cues()
        self.assertTrue(exact)
        self.assertEqual([c["text"] for c in cues],
                         ["Welcome to the course.", "It starts here, then it goes on!", "Is that clear?"])

    def test_caption_text_equals_script(self):
        cues, _ = self.cues()
        self.assertEqual(" ".join(c["text"] for c in cues), SCRIPT)

    def test_caption_text_equals_script_with_odd_whitespace(self):
        script = "One sentence.   Two\nsentences."
        sentences = narrate.split_sentences(script)
        self.assertEqual(" ".join(sentences), "One sentence. Two\nsentences.")

    def test_times_are_ordered_and_inside_the_audio(self):
        tokens, duration = fake_tokens(SCRIPT)
        text, spans = narrate.words_with_offsets(tokens)
        cues, _ = narrate.build_cues(SCRIPT, spans, duration)
        for a, b in zip(cues, cues[1:]):
            self.assertLessEqual(a["end"], b["start"])
        for c in cues:
            self.assertLess(c["start"], c["end"])
            self.assertLessEqual(c["end"], duration)

    def test_first_cue_starts_when_the_first_word_does(self):
        cues, _ = self.cues()
        self.assertAlmostEqual(cues[0]["start"], 0.25)

    def test_cue_at(self):
        cues, _ = self.cues()
        self.assertEqual(narrate.cue_at(cues, 0.3)["text"], "Welcome to the course.")
        self.assertIsNone(narrate.cue_at(cues, 0.0))
        self.assertIsNone(narrate.cue_at(cues, 999))

    def test_untimed_sentences_are_estimated_and_flagged(self):
        cues, exact = narrate.build_cues(SCRIPT, [], 10.0)
        self.assertFalse(exact)
        self.assertEqual(len(cues), 3)
        self.assertEqual(cues[0]["start"], 0.0)
        self.assertLessEqual(cues[-1]["end"], 10.0)

    def test_pronunciation_markup(self):
        out = narrate.apply_pronunciations("Rate it on a Likert scale. Likertish stays.",
                                           [{"term": "Likert", "ipa": "lik"}])
        self.assertEqual(out, "Rate it on a [Likert](/lik/) scale. Likertish stays.")


class RunOptions(unittest.TestCase):
    """--only and --cache-root, tested with a stand-in for the speech model."""

    def setUp(self):
        import json
        import tempfile
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="openstage-narrate-test-"))
        self.project = self.tmp / "project"
        (self.project / "slides").mkdir(parents=True)
        (self.project / "project.json").write_text(json.dumps({"scenes": [{"slides": ["s1"]}]}), encoding="utf-8")

        def narrated(oid, script):
            return {"id": oid, "narration": {"script": script, "voice": "af_heart", "speed": 1.0, "lang": "en-US",
                                             "pronunciations": [], "audioCache": None}}
        slide = {"baseLayer": {"objects": [narrated("a", "First one."), narrated("b", "Second one.")]}, "layers": []}
        (self.project / "slides" / "s1.json").write_text(json.dumps(slide), encoding="utf-8")
        self.made = []
        self.real_generate = narrate.generate

        def fake_generate(cache_dir, n):
            self.made.append((str(cache_dir), n["script"]))
            key, wav, meta = narrate.cache_paths(cache_dir, n)
            wav.parent.mkdir(parents=True, exist_ok=True)
            wav.write_bytes(b"RIFF")
            meta.write_text(json.dumps({"duration": 1.5, "exactTimings": True, "cues": []}), encoding="utf-8")
        narrate.generate = fake_generate

    def tearDown(self):
        import shutil
        narrate.generate = self.real_generate
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_everything_missing_is_made_by_default(self):
        result = narrate.run(self.project, log=lambda *_: None)
        self.assertEqual([s for _, s in self.made], ["First one.", "Second one."])
        self.assertTrue(all(info["audio"] for info in result.values()))

    def test_only_makes_the_objects_asked_for(self):
        result = narrate.run(self.project, log=lambda *_: None, only={"b"})
        self.assertEqual([s for _, s in self.made], ["Second one."])
        self.assertIsNone(result["a"]["audio"], "the one not asked for is left without audio")
        self.assertIsNotNone(result["b"]["audio"])

    def test_audio_that_already_exists_is_not_made_again(self):
        narrate.run(self.project, log=lambda *_: None)
        self.made.clear()
        narrate.run(self.project, log=lambda *_: None)
        self.assertEqual(self.made, [])

    def test_the_cache_can_live_somewhere_else(self):
        elsewhere = self.tmp / "real-project"
        elsewhere.mkdir()
        result = narrate.run(self.project, log=lambda *_: None, cache_root=elsewhere)
        self.assertTrue(all(cache == str(elsewhere) for cache, _ in self.made))
        self.assertTrue((elsewhere / ".cache" / "narration").is_dir())
        self.assertFalse((self.project / ".cache").exists(), "nothing is written beside the copied files")
        self.assertTrue(all(info["audio"] for info in result.values()))

    def test_nothing_is_made_with_no_generate(self):
        result = narrate.run(self.project, allow_generate=False, log=lambda *_: None)
        self.assertEqual(self.made, [])
        self.assertTrue(all(info["audio"] is None for info in result.values()))

    def add_interaction(self):
        """Give the slide an interaction whose second item is narrated."""
        import json
        path = self.project / "slides" / "s1.json"
        slide = json.loads(path.read_text(encoding="utf-8"))
        item = lambda iid, n: {"id": iid, "title": iid, "body": "", "image": None, "narration": n}  # noqa: E731
        spoken = {"script": "Item two speaks.", "voice": "af_heart", "speed": 1.0, "lang": "en-US",
                  "pronunciations": [], "audioCache": None}
        slide["baseLayer"]["objects"].append({"id": "ix", "type": "interaction", "narration": None,
                                              "content": {"kind": "tabs", "orientation": "horizontal", "allowMultiple": False,
                                                          "items": [item("one", None), item("two", spoken)]}})
        path.write_text(json.dumps(slide), encoding="utf-8")

    def test_an_interactions_items_are_narrated_under_their_own_keys(self):
        self.add_interaction()
        self.assertEqual([key for _, key, _ in narrate.narrated_objects(self.project)], ["a", "b", "ix/two"])
        result = narrate.run(self.project, log=lambda *_: None)
        self.assertEqual(sorted(result), ["a", "b", "ix/two"], "an item with no narration is not listed")
        self.assertEqual(result["ix/two"]["script"], "Item two speaks.")
        self.assertTrue(result["ix/two"]["audio"])

    def test_only_can_name_a_single_item(self):
        self.add_interaction()
        result = narrate.run(self.project, log=lambda *_: None, only={"ix/two"})
        self.assertEqual([s for _, s in self.made], ["Item two speaks."])
        self.assertIsNone(result["a"]["audio"])
        self.assertIsNotNone(result["ix/two"]["audio"])

    def test_the_command_line_is_read(self):
        nothing_else = {"allow_network": set(), "plugins_dir": None, "plugins_enabled": set()}
        self.assertEqual(narrate.parse_args(["P"]), ("P", {"only": None, "cache_root": None, **nothing_else}))
        self.assertEqual(narrate.parse_args(["P", "--json", "--only", "a,b", "--cache-root", "C"]),
                         ("P", {"only": {"a", "b"}, "cache_root": "C", **nothing_else}))
        self.assertIsNone(narrate.parse_args([]))
        self.assertIsNone(narrate.parse_args(["P", "Q"]))
        self.assertIsNone(narrate.parse_args(["P", "--only"]))
        self.assertIsNone(narrate.parse_args(["P", "--cache-root"]))


if __name__ == "__main__":
    unittest.main(verbosity=1)
