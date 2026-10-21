# SPDX-License-Identifier: Apache-2.0
"""Tests for slide sets: making one from slides of a project, reading one, and everything a set is refused for."""
import contextlib
import io
import json
import pathlib
import shutil
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import slideset as s  # noqa: E402
import validate  # noqa: E402

EXAMPLES = validate.ROOT / "examples"


class Temp(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="openstage-sets-"))
        self.addCleanup(shutil.rmtree, self.dir, True)

    def make(self, example, slides, name="set.osset", **over):
        args = dict(title="A test set", author="A. Maker", licence="Free to use and change", description="For the tests.")
        args.update(over)
        return s.make(EXAMPLES / f"{example}.osproj", slides, self.dir / name, **args)

    def rewrite(self, source, name, change):
        """A copy of a set with its members changed by `change(members)`, where members maps each name to its bytes."""
        with zipfile.ZipFile(source) as z:
            members = {i.filename: z.read(i.filename) for i in z.infolist() if not i.is_dir()}
        change(members)
        out = self.dir / name
        with zipfile.ZipFile(out, "w") as z:
            for n, data in members.items():
                z.writestr(n, data)
        return out

    def refused(self, path, word):
        with self.assertRaises(s.SetError) as ctx:
            s.read(path)
        self.assertIn(word.lower(), str(ctx.exception).lower())


class Making(Temp):
    def test_a_conversation_is_made_with_its_pictures_and_where_they_came_from(self):
        summary = self.make("conversation", ["slide-001", "slide-002"])
        self.assertTrue(summary["ok"])
        self.assertEqual([x["path"] for x in summary["assets"]], sorted(x["path"] for x in summary["assets"]))
        self.assertEqual(len(summary["assets"]), 5)
        self.assertEqual(len(summary["credits"]), 5)
        self.assertEqual(summary["set"]["title"], "A test set")
        self.assertEqual(summary["set"]["stage"], {"width": 1280, "height": 720})
        self.assertEqual(len(summary["slides"]), 2)
        with zipfile.ZipFile(self.dir / "set.osset") as z:
            names = set(z.namelist())
        self.assertTrue({"set.json", "assets.json", "slides/slide-001.json", "slides/slide-002.json"} <= names)
        self.assertEqual(sum(n.startswith("assets/images/") for n in names), 5)

    def test_slides_are_kept_in_the_course_order_whatever_order_they_were_asked_for_in(self):
        summary = self.make("conversation", ["slide-002", "slide-001"])
        self.assertEqual(summary["set"]["id"], "a-test-set")
        manifest = json.loads(zipfile.ZipFile(self.dir / "set.osset").read("set.json"))
        self.assertEqual(manifest["slides"], ["slide-001", "slide-002"])

    def test_a_way_to_a_slide_that_is_not_in_the_set_is_left_out_and_counted(self):
        summary = self.make("quiz-board", ["slide-002", "slide-003"])
        self.assertGreater(summary["dropped"], 0, "the board's tiles go to question slides that are not in the set")
        archive = zipfile.ZipFile(self.dir / "set.osset")
        manifest = json.loads(archive.read("set.json"))
        for sid in manifest["slides"]:
            slide = json.loads(archive.read(f"slides/{sid}.json"))
            for layer in [slide["baseLayer"]] + slide["layers"]:
                for o in layer["objects"]:
                    for t in o["triggers"]:
                        if t["action"] == "jumpToSlide":
                            self.assertIn(t["target"], manifest["slides"])

    def test_the_whole_of_a_game_goes_with_its_variables_and_the_course_setting_it_needs(self):
        project = json.loads((EXAMPLES / "quiz-board.osproj" / "project.json").read_text(encoding="utf-8"))
        slides = [x for scene in project["scenes"] for x in scene["slides"]]
        summary = self.make("quiz-board", slides)
        self.assertEqual(summary["dropped"], 0)
        self.assertEqual(len(summary["variables"]), len(project["variables"]))
        self.assertEqual(summary["set"]["completion"], "last")

    def test_the_people_of_a_scenario_go_with_it_and_only_the_people_it_uses(self):
        project = json.loads((EXAMPLES / "scenario.osproj" / "project.json").read_text(encoding="utf-8"))
        everything = self.make("scenario", [x for scene in project["scenes"] for x in scene["slides"]], name="all.osset")
        self.assertEqual(sorted(c["id"] for c in everything["characters"]), ["alex", "jordan", "maya"])
        self.assertTrue(everything["assets"])
        part = self.make("scenario", ["slide-001"], name="part.osset")
        self.assertEqual(sorted(c["id"] for c in part["characters"]), ["alex", "jordan"], "a slide that offers two people to choose from brings those two, and not Maya")
        none = self.make("conversation", ["slide-001"], name="plain.osset")
        self.assertEqual(none["characters"], [])

    def test_a_value_a_text_shows_brings_its_variable(self):
        project = self.dir / "p.osproj"
        shutil.copytree(EXAMPLES / "minimal.osproj", project, ignore=shutil.ignore_patterns(".cache"))
        pj = json.loads((project / "project.json").read_text(encoding="utf-8"))
        pj["variables"] = [{"id": "var-1", "name": "Tries", "type": "number", "initial": 0}, {"id": "var-2", "name": "Unused", "type": "number", "initial": 0}]
        (project / "project.json").write_text(json.dumps(pj), encoding="utf-8")
        slide = json.loads((project / "slides" / "slide-001.json").read_text(encoding="utf-8"))
        slide["baseLayer"]["objects"][1]["content"]["html"] = "<p>You have used {{tries}} goes.</p>"
        (project / "slides" / "slide-001.json").write_text(json.dumps(slide), encoding="utf-8")
        summary = s.make(project, ["slide-001"], self.dir / "values.osset", "Goes", "", "Free to use")
        self.assertEqual([v["name"] for v in summary["variables"]], ["Tries"])

    def test_a_set_needs_a_title_and_a_licence_and_a_slide(self):
        for over in ({"title": " "}, {"licence": ""}):
            with self.assertRaises(s.SetError):
                self.make("conversation", ["slide-001"], **over)
        with self.assertRaises(s.SetError):
            self.make("conversation", [])
        with self.assertRaises(s.SetError):
            self.make("conversation", ["slide-099"])

    def test_the_project_is_not_changed(self):
        before = (EXAMPLES / "conversation.osproj" / "slides" / "slide-001.json").read_bytes()
        self.make("conversation", ["slide-001"])
        self.assertEqual((EXAMPLES / "conversation.osproj" / "slides" / "slide-001.json").read_bytes(), before)

    def test_a_missing_file_is_named(self):
        project = self.dir / "p.osproj"
        shutil.copytree(EXAMPLES / "conversation.osproj", project)
        (project / "assets" / "images" / "ken-think.webp").unlink()
        with self.assertRaises(s.SetError) as ctx:
            s.make(project, ["slide-001"], self.dir / "x.osset", "T", "", "Free")
        self.assertIn("ken-think.webp", str(ctx.exception))


class Reading(Temp):
    def test_a_set_is_read_and_unpacked_as_a_small_course(self):
        self.make("conversation", ["slide-001", "slide-002"])
        stage = self.dir / "stage"
        answer = s.read(self.dir / "set.osset", stage)
        self.assertTrue(answer["ok"])
        self.assertTrue((stage / "project.json").is_file())
        self.assertTrue((stage / "slides" / "slide-001.json").is_file())
        self.assertTrue((stage / "assets" / "images" / "open-plan-1.webp").is_file())
        self.assertEqual(answer["stage"], str(stage))
        self.assertEqual(len(answer["assets"]), 5)
        self.assertFalse(answer["migrated"])

    def test_reading_without_a_stage_leaves_nothing_behind(self):
        self.make("conversation", ["slide-001"])
        before = set(pathlib.Path(tempfile.gettempdir()).glob("openstage-set-*"))
        answer = s.read(self.dir / "set.osset")
        self.assertEqual(answer["stage"], "")
        self.assertEqual(set(pathlib.Path(tempfile.gettempdir()).glob("openstage-set-*")), before)

    def test_a_set_made_in_an_older_format_is_brought_up_to_date(self):
        self.make("conversation", ["slide-001"])

        def older(members):
            m = json.loads(members["set.json"])
            m["schemaVersion"] = "0.30.0"
            members["set.json"] = json.dumps(m).encode()
        path = self.rewrite(self.dir / "set.osset", "older.osset", older)
        answer = s.read(path)
        self.assertTrue(answer["migrated"])

    def test_a_set_from_a_newer_program_is_refused_with_words(self):
        self.make("conversation", ["slide-001"])

        def newer(members):
            m = json.loads(members["set.json"])
            m["schemaVersion"] = "9.0.0"
            members["set.json"] = json.dumps(m).encode()
        self.refused(self.rewrite(self.dir / "set.osset", "newer.osset", newer), "newer version")

        def future(members):
            m = json.loads(members["set.json"])
            m["setVersion"] = 2
            members["set.json"] = json.dumps(m).encode()
        self.refused(self.rewrite(self.dir / "set.osset", "future.osset", future), "update OpenStage Author")

    def test_slides_that_are_broken_are_refused_and_the_problem_is_said(self):
        self.make("conversation", ["slide-001"])

        def broken(members):
            slide = json.loads(members["slides/slide-001.json"])
            slide["baseLayer"]["objects"][2]["accessibility"]["altText"] = ""
            slide["baseLayer"]["objects"][2]["accessibility"]["decorative"] = False
            members["slides/slide-001.json"] = json.dumps(slide).encode()
        self.refused(self.rewrite(self.dir / "set.osset", "broken.osset", broken), "a problem that stops them")

    def test_the_whole_command_line_answers_in_json(self):
        self.make("conversation", ["slide-001"])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            s.main(["check", str(self.dir / "set.osset")])
        self.assertTrue(json.loads(out.getvalue())["ok"])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            s.main(["check", str(self.dir / "missing.osset")])
        answer = json.loads(out.getvalue())
        self.assertFalse(answer["ok"])
        self.assertIn("zip", answer["message"])


class Refusing(Temp):
    def setUp(self):
        super().setUp()
        self.make("conversation", ["slide-001", "slide-002"])
        self.good = self.dir / "set.osset"

    def test_what_is_not_a_zip_file_or_not_a_set_is_refused(self):
        junk = self.dir / "junk.osset"
        junk.write_bytes(b"not a zip file")
        self.refused(junk, "not a zip")
        self.refused(self.rewrite(self.good, "no-manifest.osset", lambda m: m.pop("set.json")), "no set.json")

    def test_names_that_climb_out_or_name_other_places_are_refused(self):
        for bad in ("../evil.json", "/evil.json", "assets/../../evil.png", "C:/evil.png", ".hidden/x.json"):
            with self.subTest(bad=bad):
                self.refused(self.rewrite(self.good, "bad.osset", lambda m, b=bad: m.update({b: b"x"})), "not allowed")

    def test_a_backslash_in_a_name_is_not_allowed(self):
        self.assertFalse(s._member_name_ok("assets" + chr(92) + "images" + chr(92) + "evil.png"))
        self.assertTrue(s._member_name_ok("assets/images/fine.png"))

    def test_only_slides_pictures_sounds_video_captions_and_words_are_allowed_in(self):
        for bad in ("assets/images/page.html", "assets/images/vector.svg", "assets/documents/book.pdf", "slides/extra.txt", "run.bat", "assets/other/x.png", "assets/images/tool.exe"):
            with self.subTest(bad=bad):
                self.refused(self.rewrite(self.good, "bad.osset", lambda m, b=bad: m.update({b: b"x"})), "holds only slides")

    def test_a_picture_is_what_it_says_inside(self):
        def lie(members):
            members["assets/images/open-plan-1.webp"] = b"this is words, not a picture"
        self.refused(self.rewrite(self.good, "lie.osset", lie), "not really a picture")

    def test_a_link_inside_the_zip_is_refused(self):
        out = self.dir / "link.osset"
        with zipfile.ZipFile(self.good) as z:
            members = {i.filename: z.read(i.filename) for i in z.infolist()}
        with zipfile.ZipFile(out, "w") as z:
            for n, data in members.items():
                z.writestr(n, data)
            info = zipfile.ZipInfo("assets/images/link.png")
            info.external_attr = 0o120777 << 16
            z.writestr(info, "../../secret")
        self.refused(out, "link")

    def test_names_that_differ_only_by_capitals_are_refused(self):
        self.refused(self.rewrite(self.good, "caps.osset", lambda m: m.update({"assets/images/OPEN-PLAN-1.webp": m["assets/images/open-plan-1.webp"]})), "capital")

    def test_a_file_that_is_too_large_is_refused(self):
        old = s.MAX_FILE_BYTES
        s.MAX_FILE_BYTES = 1000
        try:
            self.refused(self.good, "larger than")
        finally:
            s.MAX_FILE_BYTES = old

    def test_a_manifest_that_is_wrong_is_refused_in_words(self):
        def bad(change):
            def go(members):
                m = json.loads(members["set.json"])
                change(m)
                members["set.json"] = json.dumps(m).encode()
            return go
        cases = [
            (lambda m: m.update(id="Bad Id"), "\"id\""),
            (lambda m: m.update(title=""), "title"),
            (lambda m: m.update(licence=""), "licence"),
            (lambda m: m.update(schemaVersion="one"), "schemaVersion"),
            (lambda m: m.update(stage={"width": 5}), "stage"),
            (lambda m: m.update(slides=[]), "slides"),
            (lambda m: m.update(slides=["slide-001", "slide-001"]), "twice"),
            (lambda m: m.update(completion="always"), "completion"),
            (lambda m: m.update(slides=["slide-001", "slide-077"]), "not in the set"),
            (lambda m: m.update(created="yesterday"), "created"),
        ]
        for i, (change, word) in enumerate(cases):
            with self.subTest(i=i):
                self.refused(self.rewrite(self.good, f"m{i}.osset", bad(change)), word)

    def test_a_slide_that_is_not_listed_is_refused(self):
        self.refused(self.rewrite(self.good, "extra.osset", lambda m: m.update({"slides/slide-009.json": m["slides/slide-001.json"]})), "does not list")

    def test_slides_that_are_not_json_are_refused(self):
        self.refused(self.rewrite(self.good, "json.osset", lambda m: m.update({"slides/slide-001.json": b"{ not json"})), "not written as json")


if __name__ == "__main__":
    unittest.main(verbosity=1)
