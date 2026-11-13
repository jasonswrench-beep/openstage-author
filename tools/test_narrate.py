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


class AnyLanguage(unittest.TestCase):
    """A course may be in a language a Windows pipe cannot carry unless the tool says UTF-8 (the narration of a translated course used to stop the
    publisher: the tool crashed printing it, and the course was published with no narration at all)."""

    def test_the_command_line_reports_narration_in_any_script(self):
        import json
        import os
        import shutil
        import subprocess
        import tempfile

        root = pathlib.Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as tmp:
            project = pathlib.Path(tmp) / "p.osproj"
            shutil.copytree(root / "examples" / "minimal.osproj", project, ignore=shutil.ignore_patterns(".cache"))
            slide = project / "slides" / "slide-001.json"
            data = json.loads(slide.read_text(encoding="utf-8"))
            words = "\u7d44\u7e54\u306e\u30b3\u30df\u30e5\u30cb\u30b1\u30fc\u30b7\u30e7\u30f3 \u1e82\u1e83 \u0416\u0436"
            for obj in data["baseLayer"]["objects"]:
                if obj.get("narration"):
                    obj["narration"]["script"] = words
            slide.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            env = {k: v for k, v in os.environ.items() if k not in ("PYTHONIOENCODING", "PYTHONUTF8")}
            run = subprocess.run([sys.executable, str(root / "tools" / "narrate.py"), str(project), "--json", "--no-generate"], capture_output=True, env=env)
            self.assertEqual(run.returncode, 0, run.stderr.decode("utf-8", "replace"))
            said = json.loads(run.stdout.decode("utf-8"))
            self.assertIn(words, [item["script"] for item in said.values()])


class VoiceNames(unittest.TestCase):
    """Only an exact name from kokoro-voices.json ever reaches Kokoro, which would read anything else as a voice file to load."""

    def setUp(self):
        import types
        self.made = []
        fake = types.ModuleType("kokoro")

        class KPipeline:  # stands in for Kokoro; it records what it was asked and reads nothing
            def __init__(inner, lang_code, repo_id):
                self.made.append(("pipeline", lang_code, repo_id))

            def __call__(inner, text, voice, speed, split_pattern):
                self.made.append(("voice", voice))
                return iter(())

        fake.KPipeline = KPipeline
        self.saved = sys.modules.get("kokoro")
        sys.modules["kokoro"] = fake
        narrate._pipelines.clear()

    def tearDown(self):
        if self.saved is None:
            sys.modules.pop("kokoro", None)
        else:
            sys.modules["kokoro"] = self.saved
        narrate._pipelines.clear()

    def narration(self, voice):
        return {"voice": voice, "script": "Hello.", "pronunciations": [], "speed": 1.0}

    def test_names_that_are_not_listed_voices_are_refused_before_kokoro(self):
        for voice in ("af_heart,af_bella", "af_heart, am_adam", "C:\\Users\\someone\\voice.pt", "\\\\server\\share\\voice.pt",
                      "//server/share/voice.pt", "../voices/af_heart.pt", "voices/af_heart", "af_heart.pt", "af_heart.bin",
                      "https://example.org/voice.pt", "AF_HEART", " af_heart", "af_heart ", "", None, 7, ["af_heart"]):
            with self.assertRaises(narrate.engine_common.EngineError, msg=repr(voice)) as raised:
                narrate.synthesise(self.narration(voice))
            self.assertIn("is not one of Kokoro's voices", str(raised.exception))
        self.assertEqual(self.made, [], "Kokoro was never started for a refused voice")

    def test_every_listed_voice_still_reaches_kokoro(self):
        try:
            import numpy  # noqa: F401  (synthesise joins the pieces with numpy)
        except ImportError:
            self.skipTest("numpy is not installed here")
        listed = sorted(narrate.kokoro_voices())
        self.assertGreater(len(listed), 50)
        for voice in listed:
            self.assertEqual(narrate.checked_kokoro_voice(voice), voice)
        for voice in ("af_heart", "bm_george", listed[-1]):
            self.made.clear()
            try:
                narrate.synthesise(self.narration(voice))
            except ValueError:
                pass  # the stand-in makes no audio to join; what matters is what Kokoro was asked
            self.assertIn(("voice", voice), self.made)
            self.assertEqual(self.made[0][1], voice[0], "the pipeline is the voice's own language")


if __name__ == "__main__":
    unittest.main(verbosity=1)
