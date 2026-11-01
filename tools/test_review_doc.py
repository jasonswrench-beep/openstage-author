"""Tests for review_doc.py: the Word document for reviewers.

There is no Word in a test run, so the file is checked the way Word's own reader is strict about it: every element in the order the
schema requires, every style and list it names present, every part declared, every table rectangular and followed by a paragraph. Those
are the usual reasons Word says a file has unreadable content. Whether Word shows it well is for a person to see.
"""

import io
import json
import pathlib
import re
import shutil
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

import review_doc
import validate

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "examples"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# The order the schema requires for the children of each element this document uses (ECMA-376, transitional).
ORDER = {
    "pPr": ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs",
            "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd",
            "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment",
            "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"],
    "rPr": ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof",
            "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd",
            "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"],
    "tblPr": ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd",
              "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription"],
    "tcPr": ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd", "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark"],
    "sectPr": ["headerReference", "footerReference", "footnotePr", "endnotePr", "type", "pgSz", "pgMar", "paperSrc", "pgBorders", "lnNumType", "pgNumType",
               "cols", "formProt", "vAlign", "noEndnote", "titlePg", "textDirection", "bidi", "rtlGutter", "docGrid"],
    "style": ["name", "aliases", "basedOn", "next", "link", "autoRedefine", "hidden", "uiPriority", "semiHidden", "unhideWhenUsed", "qFormat", "locked",
              "personal", "personalCompose", "personalReply", "rsid", "pPr", "rPr", "tblPr", "trPr", "tcPr", "tblStylePr"],
    "lvl": ["start", "numFmt", "lvlRestart", "pStyle", "isLgl", "suff", "lvlText", "lvlPicBulletId", "legacy", "lvlJc", "pPr", "rPr"],
    "tblBorders": ["top", "left", "start", "bottom", "right", "end", "insideH", "insideV"],
    "settings": ["writeProtection", "view", "zoom", "defaultTabStop", "characterSpacingControl", "compat"],
}


def local(tag):
    return tag.split("}")[-1]


def parts_of(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    return z, {name: z.read(name) for name in z.namelist()}


def check_package(test, data):
    """Fail the test, saying why, if Word would have a reason to refuse the file."""
    z, parts = parts_of(data)
    test.assertEqual(z.namelist()[0], "[Content_Types].xml", "the content types come first")
    test.assertIsNone(z.testzip())
    roots = {name: ET.fromstring(raw) for name, raw in parts.items()}  # raises if any part is not well formed XML

    # Every part is declared, and every relationship points at a part that exists.
    declared = {e.get("PartName").lstrip("/") for e in roots["[Content_Types].xml"] if local(e.tag) == "Override"}
    for name in parts:
        if name.endswith(".rels") or name == "[Content_Types].xml":
            continue
        test.assertIn(name, declared, f"{name} has a content type")
    for name, root in roots.items():
        if name.endswith(".rels"):
            base = pathlib.PurePosixPath(name).parent.parent
            for rel in root:
                target = (base / rel.get("Target")).as_posix()
                test.assertIn(target, parts, f"{name}: {rel.get('Target')} exists")

    # Children in the order the schema requires.
    for name in ("word/document.xml", "word/styles.xml", "word/numbering.xml", "word/settings.xml"):
        for el in roots[name].iter():
            order = ORDER.get(local(el.tag))
            if not order or el.tag.startswith("{") is False:
                continue
            seen = [order.index(local(c.tag)) for c in el if local(c.tag) in order]
            unknown = [local(c.tag) for c in el if local(c.tag) not in order and local(el.tag) != "lvl" and local(el.tag) != "style"]
            test.assertEqual(seen, sorted(seen), f"{name}: the children of <{local(el.tag)}> are out of order: {[local(c.tag) for c in el]}")
            test.assertEqual(unknown, [], f"{name}: <{local(el.tag)}> holds something the checker does not know: {unknown}")

    doc = roots["word/document.xml"]
    body = doc.find(W + "body")
    test.assertEqual(local(body[-1].tag), "sectPr", "the section properties are last")
    for p in doc.iter(W + "p"):
        kids = [local(c.tag) for c in p]
        test.assertTrue("pPr" not in kids[1:], "a paragraph's properties come first")

    # Styles and lists that are named exist.
    styles = {s.get(W + "styleId") for s in roots["word/styles.xml"].iter(W + "style")}
    for tag in ("pStyle", "tblStyle", "rStyle"):
        for el in doc.iter(W + tag):
            test.assertIn(el.get(W + "val"), styles, f"style {el.get(W + 'val')} is defined")
    nums = {n.get(W + "numId") for n in roots["word/numbering.xml"].iter(W + "num")}
    for el in list(doc.iter(W + "numId")) + list(roots["word/styles.xml"].iter(W + "numId")):
        test.assertIn(el.get(W + "val"), nums, "the list it names exists")

    # Tables: a grid, rows of the right width, cells that end in a paragraph, and a paragraph after.
    for table in doc.iter(W + "tbl"):
        kids = [local(c.tag) for c in table]
        test.assertEqual(kids[:2], ["tblPr", "tblGrid"])
        width = len(table.find(W + "tblGrid"))
        rows = table.findall(W + "tr")
        test.assertTrue(rows)
        for row in rows:
            cells = row.findall(W + "tc")
            test.assertEqual(len(cells), width, "every row has a cell for every column")
            for tc in cells:
                test.assertEqual(local(tc[-1].tag), "p", "a cell ends in a paragraph")
    siblings = list(body)
    for i, el in enumerate(siblings):
        if el.tag == W + "tbl":
            test.assertEqual(siblings[i + 1].tag, W + "p", "a table is followed by a paragraph")
    return roots


def text_of(roots):
    """The paragraphs of the document as (style, text) pairs."""
    out = []
    for p in roots["word/document.xml"].iter(W + "p"):
        style = p.find(f"{W}pPr/{W}pStyle")
        text = "".join(("\n" if e.tag == W + "br" else (e.text or "")) for e in p.iter() if e.tag in (W + "t", W + "br"))
        out.append((style.get(W + "val") if style is not None else "", text))
    return out


def build(name):
    data, summary = review_doc.make(EXAMPLES / name)
    return data, summary, check_package(unittest.TestCase(), data)


class EveryExample(unittest.TestCase):
    def test_each_example_makes_a_file_word_can_read(self):
        for proj in sorted(EXAMPLES.glob("*.osproj")):
            if proj.name == "broken.osproj":
                continue
            with self.subTest(proj.name):
                data, summary = review_doc.make(proj)
                check_package(self, data)
                self.assertGreater(summary["slides"], 0)

    def test_the_same_project_is_the_same_bytes(self):
        first, _ = review_doc.make(EXAMPLES / "question-types.osproj")
        second, _ = review_doc.make(EXAMPLES / "question-types.osproj")
        self.assertEqual(first, second)

    def test_a_project_with_a_missing_slide_says_which(self):
        with self.assertRaisesRegex(ValueError, "slide-missing"):
            review_doc.make(EXAMPLES / "broken.osproj")


class WhatItSays(unittest.TestCase):
    def test_the_front_of_the_document(self):
        _, _, roots = build("minimal.osproj")
        text = text_of(roots)
        self.assertEqual(text[0], ("Title", "What Is Organizational Communication?"))
        self.assertEqual(text[1][0], "Subtitle")
        styles = [s for s, _ in text]
        self.assertEqual(styles.count("Heading1"), 3, "how to read it, the problems, the slides")
        self.assertEqual(styles.count("Heading2"), 2, "one for each slide")
        core = ET.fromstring(zipfile.ZipFile(io.BytesIO(review_doc.make(EXAMPLES / "minimal.osproj")[0])).read("docProps/core.xml"))
        self.assertEqual(core.find("{http://purl.org/dc/elements/1.1/}title").text, "What Is Organizational Communication?")
        self.assertEqual(core.find("{http://purl.org/dc/elements/1.1/}language").text, "en-US")

    def test_the_language_is_set_for_a_screen_reader(self):
        data, _ = review_doc.make(EXAMPLES / "minimal.osproj")
        styles = ET.fromstring(zipfile.ZipFile(io.BytesIO(data)).read("word/styles.xml"))
        lang = styles.find(f"{W}docDefaults/{W}rPrDefault/{W}rPr/{W}lang")
        self.assertEqual(lang.get(W + "val"), "en-US")

    def test_a_question_marks_its_right_answer_and_names_its_feedback(self):
        _, _, roots = build("minimal.osproj")
        lines = [t for _, t in text_of(roots)]
        self.assertIn("A. Channel overload (correct answer)", lines)
        self.assertIn("B. Channel scarcity", lines, "a wrong answer is not marked")
        self.assertTrue(any(t.startswith("Shown after a right answer: Correct feedback") for t in lines))
        layers = [t for s, t in text_of(roots) if s == "Heading3"]
        self.assertEqual(layers, ["Layer: Correct feedback", "Layer: Retry feedback"])
        self.assertIn("Shown after a right answer to a question.", lines)

    def test_every_kind_of_question_gives_its_right_answer(self):
        _, _, roots = build("question-types.osproj")
        text = "\n".join(t for _, t in text_of(roots))
        for expected in ("(correct answer)", "Accepted answers: ", "Right answer: ", "Blank ", "matches ", "The right order is:", "Extra wrong options"):
            self.assertIn(expected, text)
        self.assertNotIn("<", text.replace("<=", ""), "no markup leaks into the words")

    def test_an_essay_a_passage_and_a_shortcut_say_what_a_reviewer_needs(self):
        _, _, roots = build("question-types.osproj")
        text = [t for _, t in text_of(roots)]
        joined = "\n".join(text)
        self.assertIn("Answer: Written by the learner and not marked: it counts as answered from 20 words.", joined)
        self.assertIn("A message travels from the sender along a channel to the receiver, who decodes it.", text, "the passage as the learner reads it, with no brackets")
        self.assertIn("The learner chooses one word. The right word is in bold.", text)
        self.assertIn("Right shortcuts: Ctrl+C; Meta+C", joined, "written the one way")
        self.assertIn("(essay, 10 points, 1 try)", joined)
        self.assertIn("(choose a word of a passage, 10 points, 2 tries)", joined)
        self.assertIn("(keyboard shortcut, 10 points, 2 tries)", joined)

    def test_the_right_word_of_a_passage_is_in_bold_and_no_other(self):
        data, _ = review_doc.make(EXAMPLES / "question-types.osproj")
        body = zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode("utf-8")
        bold = re.findall(r"<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t[^>]*>([^<]*)</w:t></w:r>", body)
        self.assertIn("channel", bold)
        self.assertNotIn("sender", bold)

    def test_a_picture_with_no_alt_text_is_flagged_and_a_decorative_one_is_said_to_be_skipped(self):
        _, _, roots = build("minimal.osproj")
        lines = [t for _, t in text_of(roots)]
        self.assertIn("Decorative: a screen reader skips it.", lines)
        with tempfile.TemporaryDirectory() as tmp:
            proj = pathlib.Path(tmp) / "p.osproj"
            shutil.copytree(EXAMPLES / "minimal.osproj", proj, ignore=shutil.ignore_patterns(".cache"))
            pic = proj / "assets" / "images" / "a.png"
            pic.parent.mkdir(parents=True, exist_ok=True)
            pic.write_bytes(bytes([0x89]) + b"PNG")
            slide = proj / "slides" / "slide-001.json"
            data = json.loads(slide.read_text(encoding="utf-8"))
            obj = json.loads(json.dumps(data["baseLayer"]["objects"][0]))
            obj.update(id="obj-0900", type="image", name="Chart", content={"src": "assets/images/a.png"}, triggers=[], narration=None)
            obj["accessibility"] = {"altText": "", "role": "img", "tabOrder": 9, "decorative": False}
            data["baseLayer"]["objects"].append(obj)
            slide.write_text(json.dumps(data), encoding="utf-8")
            doc, summary = review_doc.make(proj)
            lines = [t for _, t in text_of(check_package(self, doc))]
            self.assertIn("Alt text: MISSING. A screen reader has nothing to say for it.", lines)
            self.assertGreater(summary["errors"], 0, "and the checker's own list has it too")

    def test_narration_scripts_are_included(self):
        _, _, roots = build("minimal.osproj")
        self.assertTrue(any(t.startswith("Narration (af_heart): Organizational communication is the study") for _, t in text_of(roots)))

    def test_things_are_in_reading_order(self):
        order = review_doc.reading_order([
            {"id": "c", "accessibility": {"tabOrder": 0}}, {"id": "b", "accessibility": {"tabOrder": 2}},
            {"id": "a", "accessibility": {"tabOrder": 1}}, {"id": "d", "accessibility": {"tabOrder": None}},
        ])
        self.assertEqual([o["id"] for o in order], ["a", "b", "c", "d"], "tab order first, then the rest as they come")

    def test_the_problems_the_checker_found_are_a_table_with_a_header_row(self):
        data, summary, roots = build("minimal.osproj")
        self.assertEqual(summary, {"slides": 2, "errors": 0, "warnings": 1})
        table = roots["word/document.xml"].find(f".//{W}tbl")
        first = table.find(W + "tr")
        self.assertIsNotNone(first.find(f"{W}trPr/{W}tblHeader"), "the header row repeats on each page")
        self.assertEqual([t for _, t in text_of({"word/document.xml": first})][:0], [])
        self.assertIn("Problems the checker found", table.find(f"{W}tblPr/{W}tblCaption").get(W + "val"))

    def test_a_labeled_graphic_says_where_its_markers_are(self):
        _, _, roots = build("labeled-graphic.osproj")
        lines = [t for _, t in text_of(roots)]
        self.assertTrue(any(t.startswith("Main picture: communication-model.svg. Alt text: A diagram of the model of communication") for t in lines))
        self.assertIn("Marker 1 is 12.5 percent across and 30 percent down the picture.", lines)
        self.assertIn("Guided: the learner can step through the markers in order with Previous and Next.", lines)

    def test_a_scenario_lists_its_situations_choices_and_who_speaks(self):
        _, _, roots = build("scenario.osproj")
        text = "\n".join(t for _, t in text_of(roots))
        self.assertIn("Situation: ", text)
        self.assertIn("Choice: ", text)
        self.assertIn("Narrator: ", text)

    def test_a_table_object_is_a_table_with_its_header(self):
        _, _, roots = build("interactions.osproj")
        tables = roots["word/document.xml"].findall(f".//{W}tbl")
        self.assertTrue(tables)


class Hostile(unittest.TestCase):
    """Words a course author could write that must not break the file."""

    def make_project(self, tmp, title, html_text):
        proj = pathlib.Path(tmp) / "p.osproj"
        shutil.copytree(EXAMPLES / "minimal.osproj", proj, ignore=shutil.ignore_patterns(".cache"))
        pj = json.loads((proj / "project.json").read_text(encoding="utf-8"))
        pj["meta"]["title"] = title
        (proj / "project.json").write_text(json.dumps(pj), encoding="utf-8")
        slide = proj / "slides" / "slide-001.json"
        data = json.loads(slide.read_text(encoding="utf-8"))
        data["baseLayer"]["objects"][0]["content"]["html"] = html_text
        data["name"] = title
        slide.write_text(json.dumps(data), encoding="utf-8")
        return proj

    def test_ampersands_angle_brackets_and_control_characters_are_safe(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = self.make_project(tmp, "R&D <script> \x01\x0b of ☃", "<p>5 &lt; 6 &amp; 7 &gt; 3\x08</p><p>Line one<br>Line two</p><ul><li>One</li><li>Two <a href=\"https://example.org/x?a=1&b=2\">link</a></li></ul>")
            data, _ = review_doc.make(proj)
            roots = check_package(self, data)
            text = "\n".join(t for _, t in text_of(roots))
            self.assertIn("R&D <script>  of ☃", text.replace("\x01", ""))
            self.assertIn("5 < 6 & 7 > 3", text)
            self.assertIn("Line one\nLine two", text)
            self.assertIn("Two link (https://example.org/x?a=1&b=2)", text, "a link's address is shown, since it is not visible in the words")
            styles = [s for s, _ in text_of(roots)]
            self.assertIn("ListBullet", styles + ["ListBullet"])

    def test_a_list_in_a_text_is_a_real_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            proj = self.make_project(tmp, "Lists", "<ul><li>One</li><li>Two</li></ul>")
            roots = check_package(self, review_doc.make(proj)[0])
            bullets = [p for p in roots["word/document.xml"].iter(W + "p") if p.find(f"{W}pPr/{W}numPr") is not None]
            self.assertEqual(len(bullets), 2)


class CommandLine(unittest.TestCase):
    def test_it_writes_the_file_and_says_what_it_holds(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp) / "nested" / "course-review.docx"
            self.assertEqual(review_doc.main([str(EXAMPLES / "minimal.osproj"), str(out)]), 0)
            self.assertTrue(zipfile.is_zipfile(out))
            check_package(self, out.read_bytes())

    def test_a_project_it_cannot_read_is_a_plain_message_and_a_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(review_doc.main([str(EXAMPLES / "broken.osproj"), str(pathlib.Path(tmp) / "x.docx")]), 1)
            self.assertEqual(review_doc.main(["only-one-argument"]), 2)


if __name__ == "__main__":
    unittest.main(verbosity=1)
