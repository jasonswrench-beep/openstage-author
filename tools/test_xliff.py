"""Tests for xliff.py: the translation file a course goes out in and comes back from."""

import hashlib
import io
import json
import pathlib
import re
import shutil
import tempfile
import unittest
import xml.etree.ElementTree as ET

import validate
import xliff

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "examples"
NS = "{urn:oasis:names:tc:xliff:document:1.2}"
GOOD = sorted(p for p in EXAMPLES.glob("*.osproj") if p.name != "broken.osproj")


def tree_hash(folder):
    h = hashlib.sha256()
    for f in sorted(pathlib.Path(folder).rglob("*")):
        if f.is_file():
            h.update(str(f.relative_to(folder)).encode() + b"\0" + f.read_bytes())
    return h.hexdigest()


def copy_project(example, tmp, name="p.osproj"):
    dest = pathlib.Path(tmp) / name
    shutil.copytree(EXAMPLES / example, dest, ignore=shutil.ignore_patterns(".cache"))
    return dest


def jload(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def fill_targets(xlf_bytes, make_target):
    """The same file with a <target> in the units make_target answers for: make_target(source element) -> inner XML, or None to leave
    the unit without one."""
    root = ET.fromstring(xlf_bytes)
    ET.register_namespace("", xliff.XLIFF_NS)
    for tu in root.iter(NS + "trans-unit"):
        source = tu.find(NS + "source")
        inner = make_target(source)
        if inner is None:
            continue
        old = tu.find(NS + "target")
        if old is not None:
            tu.remove(old)
        target = ET.fromstring(f'<target xmlns="{xliff.XLIFF_NS}">{inner}</target>')
        tu.insert(list(tu).index(source) + 1, target)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def inner_xml(el):
    """What is inside a source or target element, as XML text."""
    return xliff.items_to_xml(xliff.items_from_element(el))


class Html(unittest.TestCase):
    CASES = [
        "<h1>Title</h1><p>One <strong>two</strong> three</p>",
        "<p>5 &lt; 6 &amp; 7 &gt; 3</p>",
        "<p> Padded </p>\n<p>Next</p>",
        "<ul><li>One</li><li>Two <a href=\"https://example.org/?a=1&amp;b=2\">link</a></li></ul>",
        "<ul><li>Outer<ul><li>Inner</li></ul></li><li>Second</li></ul>",
        "Bare words <strong>and bold</strong>",
        "Line one<br>Line two<br/>Line three",
        "<p></p><p>42</p><p>&nbsp;</p><p>...</p>",
        "<p>Unclosed paragraph",
        "</p>stray close<p>fine</p>",
        "<p><b>bold <i>both</b> italic</i> end</p>",
        "<blockquote>Quoted</blockquote><p>After</p>",
        "<p>Mixed <span style=\"color:#a00\">span</span> and <!-- a comment --> text</p>",
        "<p>Café ☃ 日本語</p>",
        "",
        "   ",
        "<",
        "a < b",
    ]

    def test_splitting_loses_nothing(self):
        for src in self.CASES:
            with self.subTest(src):
                self.assertEqual(xliff.join_parts(xliff.split_html(src), {}), src)

    def segs(self, src):
        return [tokens for kind, tokens in xliff.split_html(src) if kind == "seg"]

    def test_each_paragraph_heading_and_list_item_is_its_own_unit(self):
        self.assertEqual(len(self.segs("<h1>Title</h1><p>One</p><p>Two</p>")), 3)
        self.assertEqual(len(self.segs("<ul><li>One</li><li>Two</li></ul>")), 2)
        self.assertEqual(len(self.segs("<ul><li>Outer<ul><li>Inner</li></ul></li></ul>")), 1, "a nested list stays with its item")
        self.assertEqual(len(self.segs("Just words")), 1)

    def test_nothing_to_translate_is_not_a_unit(self):
        self.assertEqual(self.segs("<p></p><p>42</p><p>&nbsp;</p><p>...</p><p><br></p>"), [])

    def test_whitespace_around_a_unit_stays_in_the_skeleton(self):
        (seg,) = self.segs("<p>  Hello there \n</p>")
        self.assertEqual("".join(seg), "Hello there")

    def test_tags_become_inline_items_and_text_is_unescaped(self):
        (seg,) = self.segs("<p>5 &lt; 6 <strong>bold</strong> and<br>more &amp; more</p>")
        items = xliff.to_items(seg)
        self.assertEqual([(k, v) for k, v, _, _ in items], [
            ("t", "5 < 6 "), ("open", "<strong>"), ("t", "bold"), ("close", "</strong>"), ("t", " and"), ("ph", "<br>"), ("t", "more & more"),
        ])
        self.assertEqual(items[1][3], items[3][3], "an open and its close share a pair number")
        self.assertEqual(xliff.items_to_html(items), "5 &lt; 6 <strong>bold</strong> and<br>more &amp; more")

    def test_tags_that_do_not_pair_up_are_kept_as_single_items(self):
        (seg,) = self.segs("<p><b>bold <i>both</b> italic</i> end</p>")
        items = xliff.to_items(seg)
        self.assertEqual(xliff.items_to_html(items), "<b>bold <i>both</b> italic</i> end")
        pairs = [it for it in items if it[0] in ("open", "close")]
        self.assertEqual(len(pairs) % 2, 0)

    def test_the_inline_form_survives_xml(self):
        (seg,) = self.segs('<p>Go to <a href="https://example.org/?a=1&amp;b=2">our site</a> &amp; read.</p>')
        items = xliff.to_items(seg)
        xml = f"<source>{xliff.items_to_xml(items)}</source>"
        back = xliff.items_from_element(ET.fromstring(xml))
        self.assertEqual(xliff.canon(back), xliff.canon(items))
        self.assertEqual(xliff.items_to_html(back), 'Go to <a href="https://example.org/?a=1&amp;b=2">our site</a> &amp; read.')


class Export(unittest.TestCase):
    def test_every_example_gives_a_well_formed_file_with_unique_units(self):
        for proj in GOOD:
            with self.subTest(proj.name):
                data, summary = xliff.export(proj, "fr-FR")
                root = ET.fromstring(data)
                self.assertEqual(root.get("version"), "1.2")
                (file,) = root.findall(NS + "file")
                self.assertEqual(file.get("target-language"), "fr-FR")
                self.assertEqual(file.get("source-language"), jload(proj / "project.json")["meta"]["language"])
                ids = [tu.get("id") for tu in root.iter(NS + "trans-unit")]
                self.assertEqual(len(ids), len(set(ids)), "ids are unique")
                self.assertEqual(len(ids), summary["units"])
                self.assertGreater(summary["units"], 0)
                self.assertEqual(list(root.iter(NS + "target")), [], "an export has nothing translated yet")
                for tu in root.iter(NS + "trans-unit"):
                    self.assertTrue("".join(tu.find(NS + "source").itertext()).strip())
                    self.assertIsNotNone(tu.find(NS + "note"))

    def test_the_same_course_gives_the_same_file(self):
        a, _ = xliff.export(EXAMPLES / "interactions.osproj", "de-DE")
        b, _ = xliff.export(EXAMPLES / "interactions.osproj", "de-DE")
        self.assertEqual(a, b)

    def test_a_pseudo_translation_fills_every_target(self):
        data, _ = xliff.export(EXAMPLES / "question-types.osproj", "fr-FR", make_pseudo=True)
        root = ET.fromstring(data)
        units = list(root.iter(NS + "trans-unit"))
        self.assertTrue(units)
        for tu in units:
            src = "".join(tu.find(NS + "source").itertext())
            tgt = "".join(tu.find(NS + "target").itertext())
            self.assertNotEqual(src, tgt)
            self.assertTrue(tgt.startswith("[") and tgt.endswith("]"))
            self.assertEqual(tu.find(NS + "target").get("state"), "needs-review-translation")

    def test_pseudo_text_keeps_placeholders_and_is_longer(self):
        out = xliff.pseudo("A {1} carries a message from the {2} to the receiver.")
        self.assertIn("{1}", out)
        self.assertIn("{2}", out)
        self.assertGreater(len(out), len("A {1} carries a message from the {2} to the receiver."))
        self.assertEqual(out, xliff.pseudo("A {1} carries a message from the {2} to the receiver."))
        self.assertEqual(xliff.pseudo("Same"), xliff.pseudo("Same"), "the same words get the same pseudo-words, so a word bank still matches its blanks")

    def test_a_language_the_course_is_already_in_or_that_is_not_a_tag_is_refused(self):
        with self.assertRaisesRegex(xliff.XliffError, "already in en-US"):
            xliff.export(EXAMPLES / "minimal.osproj", "en-US")
        with self.assertRaisesRegex(xliff.XliffError, "not a language tag"):
            xliff.export(EXAMPLES / "minimal.osproj", "French please")
        data, _ = xliff.export(EXAMPLES / "minimal.osproj", "en-GB")
        self.assertIn(b'target-language="en-GB"', data)

    def test_headings_text_alt_narration_quiz_and_scenario_words_are_all_there(self):
        sources = set()
        for proj in (EXAMPLES / "minimal.osproj", EXAMPLES / "question-types.osproj", EXAMPLES / "scenario.osproj", EXAMPLES / "interactions.osproj"):
            root = ET.fromstring(xliff.export(proj, "fr-FR")[0])
            sources |= {"".join(tu.find(NS + "source").itertext()) for tu in root.iter(NS + "trans-unit")}
        for expected in (
            "What is organizational communication?",        # a heading
            "Continue",                                      # a button
            "Channel overload",                              # a quiz choice
            "Silent and slow",                               # an extra wrong option
            "Written and permanent",                         # the right side of a match
            "Admit the error in the figures and give a time",        # a scenario choice
            "Planning",                                      # an interaction item title
            "Your choices are: Channel overload. Channel scarcity. Or, upward distortion.",   # a question's narration script
        ):
            self.assertTrue(expected in sources, f"{expected!r} is not in the file")

    def test_a_label_and_the_alt_text_that_says_the_same_are_one_unit(self):
        course = xliff.Course(EXAMPLES / "branching.osproj")
        mirrored = [u for u in course.units if u.mirrors]
        self.assertTrue(mirrored, "some text objects have alt text identical to their words")
        exported = {u.id for u in course.units}
        for u in mirrored:
            for file, pointer in u.mirrors:
                self.assertIn(pointer[-1], ("altText", "script"))
                self.assertEqual(xliff.norm(xliff.get_at(course.file_json(file), pointer)), u.plain)
                self.assertNotIn(f"{file}|{'/'.join(str(p) for p in pointer)}", exported, "and it is not a unit of its own")

    def test_caption_files_are_named_as_not_included(self):
        found = {}
        for proj in GOOD:
            files = xliff.Course(proj).captions()
            if files:
                found[proj.name] = files
        self.assertTrue(found, "an example has a captioned video")
        _, summary = xliff.export(EXAMPLES / next(iter(found)), "fr-FR")
        self.assertEqual(summary["captionFiles"], next(iter(found.values())))


class Coverage(unittest.TestCase):
    def test_every_string_in_every_example_is_exported_or_known_not_to_be_words(self):
        for proj in GOOD:
            with self.subTest(proj.name):
                self.assertEqual(xliff.uncovered(proj), [])

    def test_a_new_kind_of_text_nobody_told_the_exporter_about_is_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = copy_project("minimal.osproj", tmp)
            slide = proj / "slides" / "slide-001.json"
            data = jload(slide)
            data["baseLayer"]["objects"][0]["content"]["tooltip"] = "Hover for help"
            slide.write_text(json.dumps(data, indent=2), encoding="utf-8")
            found = xliff.uncovered(proj)
            self.assertEqual([(f, p) for f, p, _ in found], [("slide-001", "baseLayer.objects.[].content.tooltip")])

    def test_nothing_that_a_learner_reads_is_on_the_not_words_list(self):
        words = {"label", "title", "text", "body", "alt", "alttext", "caption", "prompt", "html", "script", "description", "message", "heading",
                 "transcript", "announce", "reflection", "statement", "achievement", "issuedby", "passmessage", "failmessage", "premise", "match"}
        for pattern in xliff.NOT_WORDS + xliff.SLIDE_NOT_WORDS + xliff.PROJECT_NOT_WORDS:
            last = pattern.split(".")[-1].lower()
            self.assertNotIn(last, words, pattern)


class Import(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = pathlib.Path(self.tmp.name)

    def out(self, name="out"):
        return self.dir / name

    def test_a_pseudo_translation_of_every_example_comes_back_whole_and_still_valid(self):
        for proj in GOOD:
            with self.subTest(proj.name):
                data, summary = xliff.export(proj, "fr-FR", make_pseudo=True)
                report = xliff.import_xliff(proj, data, self.out(proj.stem), None)
                self.assertEqual(report["translated"], summary["units"])
                self.assertEqual((report["untranslated"], report["outOfDate"], report["rejected"], report["unknown"]), (0, [], [], []))
                before = [f for f in validate.validate_project(proj) if f.severity == "error"]
                self.assertEqual(report["validator"]["errors"], len(before), report["validator"]["newErrors"])
                self.assertEqual(report["validator"]["newErrors"], [])
                self.assertEqual(jload(self.out(proj.stem) / "project.json")["meta"]["language"], "fr-FR")
                # Every word that was exported has changed, and nothing that was not exported has.
                again = xliff.Course(self.out(proj.stem))
                self.assertEqual(len(again.units), summary["units"], "the translated course has the same units")
                for u in again.units:
                    if u.kind == "plain" and u.pointer[0] != "playerText":
                        self.assertTrue(u.text.startswith("["), (u.id, u.text))
                # The player's own words come back as the project's playerText, one for every key the player has.
                table = jload(self.out(proj.stem) / "project.json")["playerText"]
                self.assertEqual(sorted(table), sorted(xliff.PLAYER_TEXT))
                for key, value in table.items():
                    self.assertTrue(value.startswith("["), (key, value))
                    self.assertEqual(sorted(re.findall(r"\{[A-Za-z0-9_]+\}", value)), sorted(re.findall(r"\{[A-Za-z0-9_]+\}", xliff.PLAYER_TEXT[key]["text"])))

    def test_into_names_the_folder_after_the_project_and_the_language(self):
        proj = copy_project("minimal.osproj", self.tmp.name, "Intro.osproj")
        data, _ = xliff.export(proj, "fr-FR", make_pseudo=True)
        report = xliff.import_xliff(proj, data, into=self.dir)
        out = pathlib.Path(report["out"])
        self.assertEqual((out.name, out.parent), ("Intro-fr-FR.osproj", self.dir.resolve()))
        self.assertTrue((out / "project.json").exists())
        with self.assertRaisesRegex(xliff.XliffError, "not empty"):
            xliff.import_xliff(proj, data, into=self.dir)
        with self.assertRaisesRegex(xliff.XliffError, "where the translated course goes"):
            xliff.import_xliff(proj, data)
        self.assertEqual(xliff.translated_name(self.dir / "Plain", "de"), "Plain-de.osproj")

    def test_the_original_is_never_touched(self):
        proj = copy_project("interactions.osproj", self.tmp.name)
        before = tree_hash(proj)
        data, _ = xliff.export(proj, "fr-FR", make_pseudo=True)
        xliff.import_xliff(proj, data, self.out(), None)
        self.assertEqual(tree_hash(proj), before)

    def test_a_translation_equal_to_the_source_changes_nothing_but_the_language(self):
        for name in ("minimal.osproj", "sliders.osproj", "question-bank.osproj"):
            with self.subTest(name):
                proj = EXAMPLES / name
                data, _ = xliff.export(proj, "fr-FR")
                same = fill_targets(data, lambda src: inner_xml(src))
                report = xliff.import_xliff(proj, same, self.out(name), None)
                self.assertEqual(report["translated"], 0)
                lang = jload(proj / "project.json")["meta"]["language"]
                for f in [proj / "project.json"] + sorted((proj / "slides").glob("*.json")):
                    mine = (self.out(name) / f.relative_to(proj)).read_bytes()
                    theirs = f.read_bytes()
                    self.assertEqual(mine.replace(b'"fr-FR"', f'"{lang}"'.encode()), theirs, f"{f.name} is written back exactly as it was, line endings and all")

    def test_each_file_keeps_its_own_line_endings(self):
        crlf = [p for p in GOOD if b"\r\n" in (p / "project.json").read_bytes()]
        lf = [p for p in GOOD if b"\r\n" not in (p / "project.json").read_bytes()]
        self.assertTrue(crlf and lf, "the examples have both")
        for proj in (crlf[0], lf[0]):
            data, _ = xliff.export(proj, "fr-FR", make_pseudo=True)
            xliff.import_xliff(proj, data, self.out(proj.stem), None)
            raw = (self.out(proj.stem) / "project.json").read_bytes()
            self.assertEqual(b"\r\n" in raw, proj in crlf)

    def test_alt_text_and_narration_that_said_the_same_words_say_the_translation(self):
        proj = EXAMPLES / "minimal.osproj"
        data, _ = xliff.export(proj, "fr-FR", make_pseudo=True)
        xliff.import_xliff(proj, data, self.out(), None)
        checked = 0
        for f in sorted((proj / "slides").glob("*.json")):
            old, new = jload(f), jload(self.out() / "slides" / f.name)
            for o_old, o_new in zip(old["baseLayer"]["objects"], new["baseLayer"]["objects"]):
                alt = o_old["accessibility"]["altText"]
                if o_old["type"] == "button":
                    if alt and alt == o_old["content"]["label"]:
                        self.assertEqual(o_new["accessibility"]["altText"], o_new["content"]["label"])
                        checked += 1
                elif alt and o_old["type"] == "text" and alt == xliff.norm(re.sub("<[^>]+>", "", o_old["content"]["html"])):
                    self.assertEqual(o_new["accessibility"]["altText"], xliff.norm(re.sub("<[^>]+>", "", o_new["content"]["html"])))
                    checked += 1
        self.assertGreater(checked, 0)

    def test_narration_is_marked_with_the_new_language_and_its_old_audio_pointer_is_cleared(self):
        proj = EXAMPLES / "minimal.osproj"
        data, _ = xliff.export(proj, "fr-FR", make_pseudo=True)
        report = xliff.import_xliff(proj, data, self.out(), None)
        self.assertGreater(report["narrationToVoice"], 0)
        seen = 0
        for f in sorted((self.out() / "slides").glob("*.json")):
            for layer in [jload(f)["baseLayer"]] + jload(f)["layers"]:
                for obj in layer["objects"]:
                    n = obj.get("narration")
                    if n and n.get("script"):
                        self.assertEqual(n["lang"], "fr-FR")
                        self.assertIsNone(n.get("audioCache"))
                        self.assertTrue(n["script"].startswith("["))
                        seen += 1
        self.assertGreater(seen, 0)

    def test_the_cache_of_audio_is_not_carried_to_the_translated_course(self):
        proj = copy_project("minimal.osproj", self.tmp.name)
        (proj / ".cache").mkdir()
        (proj / ".cache" / "speech.wav").write_bytes(b"RIFF")
        data, _ = xliff.export(proj, "fr-FR", make_pseudo=True)
        xliff.import_xliff(proj, data, self.out(), None)
        self.assertFalse((self.out() / ".cache").exists())
        self.assertTrue((self.out() / "project.json").exists())

    # ---- a real translator's changes

    def small_project(self, html_text, extra=None):
        proj = copy_project("minimal.osproj", self.tmp.name)
        slide = proj / "slides" / "slide-001.json"
        data = jload(slide)
        data["baseLayer"]["objects"][1]["content"]["html"] = html_text
        data["baseLayer"]["objects"][1]["narration"] = None
        if extra:
            extra(data)
        slide.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        return proj

    def target_for(self, proj, wanted, make):
        """Export, and give only the unit whose html starts `wanted` a translation: make(source element) -> inner XML."""
        data, _ = xliff.export(proj, "fr-FR")
        return fill_targets(data, lambda src: make(src) if "".join(src.itertext()).startswith(wanted) else None)

    def body_html(self, out):
        return jload(out / "slides" / "slide-001.json")["baseLayer"]["objects"][1]["content"]["html"]

    def test_a_tag_can_move_in_the_translation(self):
        proj = self.small_project("<h2>Keep</h2><p>Hello <strong>big</strong> world</p>")
        xlf = self.target_for(proj, "Hello", lambda s: 'Monde <bpt id="2" rid="1" ctype="bold">&lt;strong&gt;</bpt>grand<ept id="3" rid="1">&lt;/strong&gt;</ept> bonjour')
        report = xliff.import_xliff(proj, xlf, self.out(), None)
        self.assertEqual((report["translated"], report["rejected"]), (1, []))
        self.assertEqual(self.body_html(self.out()), "<h2>Keep</h2><p>Monde <strong>grand</strong> bonjour</p>")

    def test_special_characters_in_a_translation_are_written_as_html_would_have_them(self):
        proj = self.small_project("<p>Fish and chips</p>")
        xlf = self.target_for(proj, "Fish", lambda s: "Poisson &amp; frites &lt; 5 € &quot;vite&quot;")
        xliff.import_xliff(proj, xlf, self.out(), None)
        self.assertEqual(self.body_html(self.out()), "<p>Poisson &amp; frites &lt; 5 € \"vite\"</p>")

    def test_whitespace_and_blocks_around_a_unit_are_kept(self):
        proj = self.small_project("<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>\n")
        xlf = self.target_for(proj, "Two", lambda s: "Deux")
        xliff.import_xliff(proj, xlf, self.out(), None)
        self.assertEqual(self.body_html(self.out()), "<ul>\n  <li>One</li>\n  <li>Deux</li>\n</ul>\n")

    def refused(self, source_html, make, reason):
        proj = self.small_project(source_html)
        xlf = self.target_for(proj, "Hello", make)
        out = self.out("refused")
        report = xliff.import_xliff(proj, xlf, out, None)
        self.assertEqual(report["translated"], 0)
        (one,) = report["rejected"]
        self.assertRegex(one["reason"], reason)
        self.assertEqual(self.body_html(out), source_html, "the words stay in the original language")

    def test_a_translation_that_loses_a_tag_is_refused(self):
        self.refused("<p>Hello <strong>big</strong> world</p>", lambda s: "Bonjour grand monde", "tags were changed")

    def test_a_translation_that_adds_a_tag_is_refused(self):
        self.refused("<p>Hello world</p>", lambda s: 'Bonjour <ph id="9">&lt;script&gt;alert(1)&lt;/script&gt;</ph>', "tags were changed")

    def test_tags_that_cross_are_refused(self):
        self.refused("<p>Hello <b>one</b> <i>two</i></p>",
                     lambda s: '<bpt id="2" rid="1">&lt;b&gt;</bpt><bpt id="4" rid="2">&lt;i&gt;</bpt>un<ept id="3" rid="1">&lt;/b&gt;</ept> deux<ept id="5" rid="2">&lt;/i&gt;</ept>',
                     "out of order")

    def test_a_lost_placeholder_is_refused(self):
        proj = copy_project("question-types.osproj", self.tmp.name)
        data, _ = xliff.export(proj, "fr-FR")
        xlf = fill_targets(data, lambda s: "Un porteur de message" if "{1}" in "".join(s.itertext()) else None)
        report = xliff.import_xliff(proj, xlf, self.out(), None)
        self.assertTrue(report["rejected"])
        self.assertTrue(all("placeholder" in r["reason"] for r in report["rejected"]))

    def test_a_value_the_course_shows_must_keep_both_its_braces(self):
        proj = self.small_project("<p>Hello {{$score}} points</p>")
        keep = self.target_for(proj, "Hello", lambda s: "Bonjour {{$score}} points")
        report = xliff.import_xliff(proj, keep, self.out("kept"), None)
        self.assertEqual((report["translated"], report["rejected"]), (1, []))
        self.assertEqual(self.body_html(self.out("kept")), "<p>Bonjour {{$score}} points</p>")
        for name, broken in (("one", "Bonjour {$score} points"), ("renamed", "Bonjour {{score}} points"), ("lost", "Bonjour points")):
            xlf = self.target_for(proj, "Hello", lambda s, b=broken: b)
            report = xliff.import_xliff(proj, xlf, self.out(name), None)
            self.assertEqual(report["translated"], 0, broken)
            self.assertIn("placeholder", report["rejected"][0]["reason"], broken)
            self.assertEqual(self.body_html(self.out(name)), "<p>Hello {{$score}} points</p>")

    def test_tags_in_a_plain_text_unit_are_refused(self):
        proj = self.small_project("<p>Hello</p>")
        data, _ = xliff.export(proj, "fr-FR")
        xlf = fill_targets(data, lambda s: 'Titre <ph id="1">&lt;b&gt;</ph>' if "".join(s.itertext()) == "Welcome" else None)
        report = xliff.import_xliff(proj, xlf, self.out(), None)
        self.assertEqual(len(report["rejected"]), 1)
        self.assertIn("plain text", report["rejected"][0]["reason"])

    def test_an_inline_element_that_cannot_be_put_back_is_refused(self):
        self.refused("<p>Hello <strong>big</strong> world</p>", lambda s: 'Bonjour <g id="1">grand</g> monde', "cannot put back")

    def test_a_unit_with_no_translation_or_an_unchanged_one_is_left_alone(self):
        proj = self.small_project("<p>Hello</p><p>World</p>")
        data, _ = xliff.export(proj, "fr-FR")
        xlf = fill_targets(data, lambda s: "" if "".join(s.itertext()) == "Hello" else ("World" if "".join(s.itertext()) == "World" else None))
        report = xliff.import_xliff(proj, xlf, self.out(), None)
        self.assertEqual(report["translated"], 0)
        self.assertGreaterEqual(report["untranslated"], 2)
        self.assertEqual(self.body_html(self.out()), "<p>Hello</p><p>World</p>")

    def test_a_file_made_before_the_course_changed_is_not_put_back_over_the_new_words(self):
        proj = self.small_project("<p>Hello</p>")
        data, _ = xliff.export(proj, "fr-FR", make_pseudo=True)
        slide = proj / "slides" / "slide-001.json"
        d = jload(slide)
        d["baseLayer"]["objects"][1]["content"]["html"] = "<p>Hello again</p>"
        slide.write_text(json.dumps(d, indent=2) + "\n", encoding="utf-8")
        report = xliff.import_xliff(proj, data, self.out(), None)
        self.assertEqual(len(report["outOfDate"]), 1)
        self.assertEqual(self.body_html(self.out()), "<p>Hello again</p>")

    def test_units_the_course_does_not_have_are_listed_and_ignored(self):
        proj = self.small_project("<p>Hello</p>")
        data, _ = xliff.export(proj, "fr-FR", make_pseudo=True)
        extra = data.replace(b"</body>", b'<trans-unit id="slide-099|name"><source>Gone</source><target>Parti</target></trans-unit></body>')
        report = xliff.import_xliff(proj, extra, self.out(), None)
        self.assertEqual(report["unknown"], ["slide-099|name"])

    def test_the_language_comes_from_the_file_or_the_option(self):
        proj = self.small_project("<p>Hello</p>")
        data, _ = xliff.export(proj, "fr-FR", make_pseudo=True)
        bare = data.replace(b' target-language="fr-FR"', b"")
        with self.assertRaisesRegex(xliff.XliffError, "does not say which language"):
            xliff.import_xliff(proj, bare, self.out("a"), None)
        report = xliff.import_xliff(proj, bare, self.out("b"), "es-MX")
        self.assertEqual(jload(self.out("b") / "project.json")["meta"]["language"], "es-MX")
        self.assertEqual(report["language"], "es-MX")
        with self.assertRaisesRegex(xliff.XliffError, "course's own language"):
            xliff.import_xliff(proj, bare, self.out("c"), "en-US")

    # ---- files that are not what they say

    def test_a_file_with_a_document_type_is_not_read(self):
        proj = self.small_project("<p>Hello</p>")
        bomb = b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaa">]><xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"><file target-language="fr"><body>&a;</body></file></xliff>'
        with self.assertRaisesRegex(xliff.XliffError, "document type"):
            xliff.import_xliff(proj, bomb, self.out(), None)

    def test_a_file_that_is_not_xliff_is_refused_with_a_plain_message(self):
        proj = self.small_project("<p>Hello</p>")
        for bad, message in ((b"not xml at all", "well-formed"), (b"<html/>", "not an XLIFF"), (b'<xliff version="2.0" xmlns="urn:oasis:names:tc:xliff:document:2.0"/>', "XLIFF 2.0")):
            with self.subTest(bad):
                with self.assertRaisesRegex(xliff.XliffError, message):
                    xliff.import_xliff(proj, bad, self.out(), None)
        self.assertFalse(self.out().exists())

    def test_the_translated_course_goes_in_a_folder_of_its_own(self):
        proj = copy_project("minimal.osproj", self.tmp.name)
        data, _ = xliff.export(proj, "fr-FR", make_pseudo=True)
        for bad in (proj, proj / "inside", proj.parent):
            with self.assertRaisesRegex(xliff.XliffError, "folder of its own"):
                xliff.import_xliff(proj, data, bad, None)
        busy = self.out("busy")
        busy.mkdir()
        (busy / "keep.txt").write_text("mine")
        with self.assertRaisesRegex(xliff.XliffError, "not empty"):
            xliff.import_xliff(proj, data, busy, None)
        self.assertEqual((busy / "keep.txt").read_text(), "mine")
        empty = self.out("empty")
        empty.mkdir()
        xliff.import_xliff(proj, data, empty, None)
        self.assertTrue((empty / "project.json").exists())


class CommandLine(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = pathlib.Path(self.tmp.name)

    def run_main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        import contextlib
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = xliff.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_export_then_import_with_json_answers(self):
        xlf = self.dir / "sub" / "course.xlf"
        code, out, _ = self.run_main("export", str(EXAMPLES / "minimal.osproj"), str(xlf), "--to", "fr-FR", "--pseudo", "--json")
        self.assertEqual(code, 0)
        exported = out
        said = json.loads(out)
        self.assertTrue(said["ok"] and said["units"] > 0 and said["targetLanguage"] == "fr-FR")
        self.assertTrue(xlf.exists())
        code, out, _ = self.run_main("import", str(EXAMPLES / "minimal.osproj"), str(xlf), str(self.dir / "fr"), "--json")
        self.assertEqual(code, 0)
        said = json.loads(out)
        self.assertTrue(said["ok"])
        self.assertEqual(said["translated"], json.loads(exported)["units"])
        self.assertEqual(said["validator"]["errors"], 0)

    def test_import_into_a_folder_beside_the_project(self):
        xlf = self.dir / "c.xlf"
        self.assertEqual(self.run_main("export", str(EXAMPLES / "minimal.osproj"), str(xlf), "--to", "es-MX", "--pseudo")[0], 0)
        code, out, _ = self.run_main("import", str(EXAMPLES / "minimal.osproj"), str(xlf), "--into", str(self.dir / "made"), "--json")
        self.assertEqual(code, 0)
        said = json.loads(out)
        self.assertTrue(said["out"].endswith("minimal-es-MX.osproj"), said["out"])
        self.assertTrue((self.dir / "made" / "minimal-es-MX.osproj" / "project.json").exists())

    def test_the_plain_words_say_what_happened(self):
        xlf = self.dir / "c.xlf"
        code, out, _ = self.run_main("export", str(EXAMPLES / "interactions.osproj"), str(xlf), "--to", "de-DE")
        self.assertEqual(code, 0)
        self.assertRegex(out, r"\d+ units, \d+ words, from en-US to de-DE")
        code, out, _ = self.run_main("import", str(EXAMPLES / "interactions.osproj"), str(xlf), str(self.dir / "de"))
        self.assertEqual(code, 0)
        self.assertIn("left in the original language", out)
        self.assertIn("The checker finds 0 errors", out)

    def test_a_failure_is_one_plain_message_and_exit_1(self):
        code, _, err = self.run_main("export", str(EXAMPLES / "broken.osproj"), str(self.dir / "x.xlf"), "--to", "fr")
        self.assertEqual(code, 1)
        self.assertIn("The translation could not be done: The course plays slide", err)
        code, out, _ = self.run_main("export", str(EXAMPLES / "minimal.osproj"), str(self.dir / "x.xlf"), "--to", "en-US", "--json")
        self.assertEqual(code, 1)
        self.assertFalse(json.loads(out)["ok"])

    def test_wrong_use_is_exit_2(self):
        self.assertEqual(self.run_main()[0], 2)
        self.assertEqual(self.run_main("export", str(EXAMPLES / "minimal.osproj"))[0], 2)
        self.assertEqual(self.run_main("import", "a", "b")[0], 2)
        self.assertEqual(self.run_main("nonsense")[0], 2)

    def test_uncovered_is_clean_for_the_examples(self):
        code, out, _ = self.run_main("uncovered", str(EXAMPLES / "scenario.osproj"))
        self.assertEqual(code, 0)
        self.assertIn("Every string is exported", out)


if __name__ == "__main__":
    unittest.main(verbosity=1)
