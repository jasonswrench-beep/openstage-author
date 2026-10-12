"""Tests for the validator. Every rule in docs/validator-spec.md has a test that
asserts the validator reports it, so a rule that silently stops working fails here.

Run with:  python tools/test_validate.py
"""
import copy
import json
import pathlib
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import validate  # noqa: E402

EXAMPLES = validate.ROOT / "examples"


def rules(findings, rule=None, oid=None, severity=None):
    return [f for f in findings if (rule is None or f.rule == rule)
            and (oid is None or f.object_id == oid)
            and (severity is None or f.severity == severity)]


class MutatedProject:
    """A temporary copy of minimal.osproj that a test can edit before validating."""

    def __init__(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.root = self.dir / "p.osproj"
        shutil.copytree(EXAMPLES / "minimal.osproj", self.root, ignore=shutil.ignore_patterns(".cache"))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        shutil.rmtree(self.dir, ignore_errors=True)

    def edit(self, rel, fn):
        path = self.root / rel
        data = json.loads(path.read_text(encoding="utf-8"))
        fn(data)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def slide1(self, fn):
        self.edit("slides/slide-001.json", fn)

    def obj(self, index, fn, slide="slides/slide-001.json"):
        self.edit(slide, lambda d: fn(d["baseLayer"]["objects"][index]))

    def run(self):
        return validate.validate_project(self.root)


class ValidExample(unittest.TestCase):
    def test_minimal_has_no_errors(self):
        f = validate.validate_project(EXAMPLES / "minimal.osproj")
        self.assertEqual([x for x in f if x.severity == "error"], [])

    def test_minimal_only_warns_about_mixed_provenance(self):
        f = validate.validate_project(EXAMPLES / "minimal.osproj")
        self.assertEqual({x.rule for x in f}, {"provenance-mixed"})


class CompletionSetting(unittest.TestCase):
    """What completes the course is the author's choice, and "every slide seen" cannot work if a rule can skip one."""

    def branching(self, slides=None):
        tmp = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        root = tmp / "b.osproj"
        shutil.copytree(EXAMPLES / "branching.osproj", root, ignore=shutil.ignore_patterns(".cache"))
        if slides is not None:
            path = root / "project.json"
            project = json.loads(path.read_text(encoding="utf-8"))
            project["completion"] = {"slides": slides}
            path.write_text(json.dumps(project, indent=2), encoding="utf-8")
        return root

    def test_the_setting_is_required_and_only_all_or_last_are_allowed(self):
        with MutatedProject() as p:
            p.edit("project.json", lambda d: d.pop("completion"))
            self.assertTrue([f for f in p.run() if f.severity == "error" and f.file == "project.json"])
        with MutatedProject() as p:
            p.edit("project.json", lambda d: d.__setitem__("completion", {"slides": "some"}))
            self.assertTrue([f for f in p.run() if f.severity == "error" and f.file == "project.json"])
        with MutatedProject() as p:
            for ok in ("all", "last"):
                p.edit("project.json", lambda d, ok=ok: d.__setitem__("completion", {"slides": ok}))
                self.assertEqual([f for f in p.run() if f.severity == "error"], [], ok)

    def test_a_jump_past_a_slide_is_warned_about_when_every_slide_must_be_seen(self):
        found = [f for f in validate.validate_project(self.branching("all")) if f.rule == "completion-skippable"]
        self.assertEqual(len(found), 1, "one warning for the jump to slide 3, none for the jump to the next slide")
        self.assertEqual(found[0].severity, "warning")
        self.assertIn("slide 1 to slide 3", found[0].detail)
        self.assertIn("reaches the last slide", found[0].detail)

    def test_choosing_the_last_slide_removes_the_warning(self):
        self.assertEqual([f for f in validate.validate_project(self.branching("last")) if f.rule == "completion-skippable"], [])
        self.assertEqual([f for f in validate.validate_project(EXAMPLES / "branching.osproj") if f.rule == "completion-skippable"], [], "the shipped example chooses it")

    def test_a_course_with_no_jumps_is_never_warned(self):
        self.assertEqual([f for f in validate.validate_project(EXAMPLES / "minimal.osproj") if f.rule == "completion-skippable"], [])


def results_object(oid, kind, **content):
    """A results box or a certificate, as the editor would write one."""
    body = ({"heading": "Your results", "passMessage": "Well done.", "failMessage": "Review the lesson.", "review": True}
            if kind == "results" else
            {"title": "Certificate", "statement": "This certifies that", "achievement": "has passed", "issuedBy": "", "showScore": True, "showDate": True})
    body.update(content)
    return {"id": oid, "type": kind, "name": kind, "geometry": {"x": 80, "y": 200, "width": 800, "height": 300, "rotation": 0, "z": 50},
            "content": body, "style": {}, "accessibility": {"altText": "Your results" if kind == "results" else "Certificate", "role": "region", "tabOrder": 9 if kind == "results" else 10, "decorative": False},
            "states": {}, "triggers": [], "timing": {"appear": "time", "start": 0, "visibleFor": None}, "animation": {"enter": {"effect": "none", "duration": 500}, "exit": {"effect": "none", "duration": 500}}, "narration": None, "provenance": None, "simulation": None}


class ResultsAndCertificates(unittest.TestCase):
    def with_objects(self, p, *objects):
        p.slide1(lambda d: d["baseLayer"]["objects"].extend(objects))

    def test_both_kinds_are_accepted_in_a_course_that_has_a_quiz(self):
        with MutatedProject() as p:
            self.with_objects(p, results_object("obj-0090", "results"), results_object("obj-0091", "certificate"))
            found = p.run()
            self.assertEqual([f for f in found if f.severity == "error"], [])
            self.assertEqual([f for f in found if f.rule.endswith("-no-quiz")], [])

    def test_an_empty_heading_or_title_is_refused(self):
        with MutatedProject() as p:
            self.with_objects(p, results_object("obj-0090", "results", heading=""))
            self.assertTrue([f for f in p.run() if f.severity == "error"])
        with MutatedProject() as p:
            self.with_objects(p, results_object("obj-0091", "certificate", title=""))
            self.assertTrue([f for f in p.run() if f.severity == "error"])

    def test_missing_or_unknown_fields_are_refused(self):
        with MutatedProject() as p:
            def drop(d):
                d["baseLayer"]["objects"].append(results_object("obj-0090", "results"))
                del d["baseLayer"]["objects"][-1]["content"]["review"]
            p.slide1(drop)
            self.assertTrue([f for f in p.run() if f.severity == "error"])
        with MutatedProject() as p:
            self.with_objects(p, results_object("obj-0091", "certificate", showLogo=True))
            self.assertTrue([f for f in p.run() if f.severity == "error"])

    def test_a_certificate_is_a_control_so_it_must_be_reachable_by_keyboard(self):
        with MutatedProject() as p:
            cert = results_object("obj-0091", "certificate")
            cert["accessibility"]["tabOrder"] = 0
            self.with_objects(p, cert)
            self.assertTrue([f for f in p.run() if f.severity == "error"])

    def test_both_need_a_name_for_screen_readers(self):
        for kind in ("results", "certificate"):
            with MutatedProject() as p:
                o = results_object("obj-0090", kind)
                o["accessibility"]["altText"] = ""
                self.with_objects(p, o)
                self.assertTrue([f for f in p.run() if f.rule == "alt-text-missing" and f.object_id == "obj-0090"], kind)

    def test_in_a_course_with_no_quiz_both_are_warned_about(self):
        with MutatedProject() as p:
            def strip_quiz(d):
                for layer in [d["baseLayer"], *d["layers"]]:
                    layer["objects"] = [o for o in layer["objects"] if o["type"] != "quizQuestion"]
            p.edit("slides/slide-002.json", strip_quiz)
            p.edit("slides/slide-001.json", strip_quiz)
            self.with_objects(p, results_object("obj-0090", "results"), results_object("obj-0091", "certificate"))
            found = {f.rule: f for f in p.run() if f.rule.endswith("-no-quiz")}
            self.assertEqual(set(found), {"results-no-quiz", "certificate-no-quiz"})
            self.assertTrue(all(f.severity == "warning" for f in found.values()))


def download_object(oid="obj-0095", **content):
    """A file to download, as the editor would write one."""
    body = {"src": "assets/documents/guide.pdf", "title": "Course guide",
            "description": "A four page guide to the course: what it covers, how it is graded and who to ask for help.",
            "accessibleConfirmed": True}
    body.update(content)
    return {"id": oid, "type": "download", "name": "Download", "geometry": {"x": 80, "y": 200, "width": 520, "height": 220, "rotation": 0, "z": 60},
            "content": body, "style": {}, "accessibility": {"altText": "Course guide, a PDF to download", "role": "group", "tabOrder": 11, "decorative": False},
            "states": {}, "triggers": [], "timing": {"appear": "time", "start": 0, "visibleFor": None}, "animation": {"enter": {"effect": "none", "duration": 500}, "exit": {"effect": "none", "duration": 500}}, "narration": None, "provenance": None, "simulation": None}


class FilesToDownload(unittest.TestCase):
    """A file a learner can save to their own device. It must say what it is, be confirmed accessible, and be a kind of file we allow."""

    def with_download(self, p, obj=None, make_file="assets/documents/guide.pdf"):
        if make_file:
            target = p.root / make_file
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"%PDF-1.7 stand-in")
        p.slide1(lambda d: d["baseLayer"]["objects"].append(obj or download_object()))

    def errors(self, p):
        return [f for f in p.run() if f.severity == "error"]

    def test_a_described_and_confirmed_file_is_accepted(self):
        with MutatedProject() as p:
            self.with_download(p)
            self.assertEqual(self.errors(p), [])

    def test_the_kinds_of_file_that_can_be_offered(self):
        for ext in ("pdf", "docx", "doc", "xlsx", "pptx", "csv", "txt", "zip", "PDF", "DocX"):
            with MutatedProject() as p:
                src = f"assets/documents/file.{ext}"
                self.with_download(p, download_object(src=src), make_file=src)
                self.assertEqual(self.errors(p), [], ext)

    def test_programs_and_pages_cannot_be_offered(self):
        for name in ("run.exe", "setup.bat", "script.js", "page.html", "tool.ps1", "noextension", "archive.zip.exe"):
            with MutatedProject() as p:
                src = f"assets/documents/{name}"
                self.with_download(p, download_object(src=src), make_file=src)
                found = [f for f in self.errors(p) if f.rule == "download-file-type"]
                self.assertTrue(found, name)
                self.assertEqual(found[0].object_id, "obj-0095")

    def test_a_file_that_is_not_in_the_project(self):
        with MutatedProject() as p:
            self.with_download(p, make_file=None)
            self.assertTrue([f for f in self.errors(p) if f.rule == "asset-missing" and f.object_id == "obj-0095"])

    def test_a_description_is_required_and_blank_does_not_count(self):
        for blank in ("", "   ", "\n\t"):
            with MutatedProject() as p:
                self.with_download(p, download_object(description=blank))
                found = [f for f in self.errors(p) if f.rule == "download-description-missing"]
                self.assertTrue(found, repr(blank))
                self.assertIn("before they download it", found[0].detail)

    def test_a_name_is_required(self):
        with MutatedProject() as p:
            self.with_download(p, download_object(title="  "))
            self.assertTrue([f for f in self.errors(p) if f.rule == "download-title-missing"])

    def test_the_author_must_confirm_the_file_is_accessible(self):
        with MutatedProject() as p:
            self.with_download(p, download_object(accessibleConfirmed=False))
            found = [f for f in self.errors(p) if f.rule == "download-unconfirmed"]
            self.assertTrue(found)
            self.assertIn("screen reader", found[0].detail)

    def test_it_is_a_control_so_it_must_be_reachable_by_keyboard_and_named(self):
        with MutatedProject() as p:
            o = download_object()
            o["accessibility"]["tabOrder"] = 0
            self.with_download(p, o)
            self.assertTrue([f for f in self.errors(p) if f.rule == "not-keyboard-reachable"])
        with MutatedProject() as p:
            o = download_object()
            o["accessibility"]["altText"] = ""
            self.with_download(p, o)
            self.assertTrue([f for f in self.errors(p) if f.rule == "alt-text-missing" and f.object_id == "obj-0095"])

    def test_missing_or_unknown_fields_are_refused(self):
        for drop in ("src", "title", "description", "accessibleConfirmed"):
            with MutatedProject() as p:
                o = download_object()
                del o["content"][drop]
                self.with_download(p, o)
                self.assertTrue(self.errors(p), drop)
        with MutatedProject() as p:
            self.with_download(p, download_object(downloadName="x.pdf"))
            self.assertTrue(self.errors(p), "an unknown field")

    def test_the_list_of_kinds_is_the_shared_file(self):
        self.assertEqual(validate.DOWNLOAD_TYPES["pdf"], "PDF document")
        self.assertEqual(validate.DOWNLOAD_TYPES["docx"], validate.DOWNLOAD_TYPES["doc"])
        for ext in ("exe", "bat", "cmd", "js", "html", "htm", "ps1", "sh", "msi", "jar", "vbs", "scr", "dll", "svg"):
            self.assertNotIn(ext, validate.DOWNLOAD_TYPES)


class Timing(unittest.TestCase):
    """Things that appear, disappear or advance on their own."""

    def timed(self, p, index=0, **timing):
        p.obj(index, lambda o: o["timing"].update(timing))

    def errors(self, p):
        return [f for f in p.run() if f.severity == "error"]

    def test_the_starting_timing_means_always_there_and_is_clean(self):
        with MutatedProject() as p:
            found = p.run()
            self.assertEqual([f for f in found if f.rule.startswith("timing") or f.rule.startswith("slide-advances")], [])

    def test_a_delay_and_a_time_to_leave_are_accepted(self):
        with MutatedProject() as p:
            self.timed(p, 0, start=2500, visibleFor=6000)
            self.assertEqual(self.errors(p), [])

    def test_the_fields_are_all_required_and_nothing_else_is_allowed(self):
        for drop in ("appear", "start", "visibleFor"):
            with MutatedProject() as p:
                p.obj(0, lambda o, drop=drop: o["timing"].pop(drop))
                self.assertTrue(self.errors(p), drop)
        with MutatedProject() as p:
            self.timed(p, 0, loop=True)
            self.assertTrue(self.errors(p), "an unknown field")
        with MutatedProject() as p:
            p.obj(0, lambda o: o.pop("timing"))
            self.assertTrue(self.errors(p), "the whole timing missing")

    def test_bad_values_are_refused(self):
        for change in ({"appear": "later"}, {"start": -1}, {"start": 1.5}, {"start": 3600001}, {"visibleFor": 0}, {"visibleFor": -5}, {"visibleFor": 2.5}, {"start": "2"}):
            with MutatedProject() as p:
                self.timed(p, 0, **change)
                self.assertTrue(self.errors(p), str(change))

    def test_appearing_with_narration_needs_narration(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: (o["timing"].update(appear="narration"), o.__setitem__("narration", None)))
            found = [f for f in self.errors(p) if f.rule == "timing-narration-missing"]
            self.assertTrue(found)
            self.assertEqual(found[0].object_id, "obj-0001")
        with MutatedProject() as p:  # obj-0002 has narration in the example
            self.timed(p, 1, appear="narration", start=500)
            self.assertEqual([f for f in self.errors(p) if f.rule == "timing-narration-missing"], [])

    def test_a_slide_that_moves_on_with_a_question_is_warned_about(self):
        with MutatedProject() as p:
            p.edit("slides/slide-002.json", lambda d: d.__setitem__("duration", 20000))
            found = [f for f in p.run() if f.rule == "slide-advances-with-question"]
            self.assertEqual([(f.severity, f.object_id) for f in found], [("warning", "slide-002")])
        with MutatedProject() as p:
            p.edit("slides/slide-001.json", lambda d: d.__setitem__("duration", 20000))
            self.assertEqual([f for f in p.run() if f.rule == "slide-advances-with-question"], [], "no question on that slide")

    def test_an_object_that_appears_after_the_slide_moves_on_is_warned_about(self):
        with MutatedProject() as p:
            p.edit("slides/slide-001.json", lambda d: d.__setitem__("duration", 5000))
            self.timed(p, 0, start=5000)
            found = [f for f in p.run() if f.rule == "timing-after-advance"]
            self.assertEqual([(f.severity, f.object_id) for f in found], [("warning", "obj-0001")])
        with MutatedProject() as p:
            p.edit("slides/slide-001.json", lambda d: d.__setitem__("duration", 5000))
            self.timed(p, 0, start=4999)
            self.assertEqual([f for f in p.run() if f.rule == "timing-after-advance"], [])

    def test_a_control_that_disappears_is_warned_about(self):
        with MutatedProject() as p:
            p.slide1(lambda d: d["baseLayer"]["objects"].append(download_object("obj-0096")))
            p.obj(-1, lambda o: o["timing"].update(visibleFor=4000))
            (p.root / "assets" / "documents").mkdir(parents=True, exist_ok=True)
            (p.root / "assets" / "documents" / "guide.pdf").write_bytes(b"%PDF")
            found = [f for f in p.run() if f.rule == "timing-control-disappears"]
            self.assertEqual([(f.severity, f.object_id) for f in found], [("warning", "obj-0096")])

    def test_text_that_goes_before_it_can_be_read_is_warned_about(self):
        with MutatedProject() as p:
            def long_text(o):
                o["content"]["html"] = "<p>" + " ".join(["word"] * 60) + "</p>"
                o["timing"].update(visibleFor=4000)
            p.obj(1, long_text)
            found = [f for f in p.run() if f.rule == "timing-too-brief"]
            self.assertEqual([(f.severity, f.object_id) for f in found], [("warning", "obj-0002")])
            self.assertIn("60 words", found[0].detail)
        with MutatedProject() as p:
            p.obj(1, lambda o: o["timing"].update(visibleFor=30000))
            self.assertEqual([f for f in p.run() if f.rule == "timing-too-brief"], [])
        with MutatedProject() as p:
            def short(o):
                o["content"]["html"] = "<p>Hi</p>"
                o["timing"].update(visibleFor=3000)
            p.obj(1, short)
            self.assertEqual([f for f in p.run() if f.rule == "timing-too-brief"], [], "three seconds is the least asked of any text")

    def test_the_slide_duration_must_be_positive_when_set(self):
        with MutatedProject() as p:
            p.edit("slides/slide-001.json", lambda d: d.__setitem__("duration", 0))
            self.assertTrue(self.errors(p))


class Animation(unittest.TestCase):
    """How an object arrives and leaves."""

    def animate(self, p, index=1, **parts):
        p.obj(index, lambda o: o["animation"].update(parts))

    def errors(self, p):
        return [f for f in p.run() if f.severity == "error"]

    def test_the_starting_animation_is_clean(self):
        with MutatedProject() as p:
            self.assertEqual([f for f in p.run() if f.rule.startswith("animation")], [])

    def test_every_effect_is_accepted_for_both_arrival_and_leaving(self):
        for effect in ("none", "fade", "slideLeft", "slideRight", "slideTop", "slideBottom", "zoom"):
            with MutatedProject() as p:
                self.animate(p, enter={"effect": effect, "duration": 600}, exit={"effect": effect, "duration": 1200})
                p.obj(1, lambda o: o["timing"].update(visibleFor=20000))
                self.assertEqual(self.errors(p), [], effect)

    def test_the_durations_are_short_and_whole(self):
        for duration in (100, 500, 2000):
            with MutatedProject() as p:
                self.animate(p, enter={"effect": "fade", "duration": duration}, exit={"effect": "none", "duration": 500})
                self.assertEqual(self.errors(p), [], str(duration))
        for duration in (0, 99, 2001, 5000, -1, 250.5, "500", None):
            with MutatedProject() as p:
                self.animate(p, enter={"effect": "fade", "duration": duration}, exit={"effect": "none", "duration": 500})
                self.assertTrue(self.errors(p), repr(duration))

    def test_unknown_effects_missing_parts_and_extra_fields_are_refused(self):
        with MutatedProject() as p:
            self.animate(p, enter={"effect": "spin", "duration": 500}, exit={"effect": "none", "duration": 500})
            self.assertTrue(self.errors(p), "an effect that does not exist")
        with MutatedProject() as p:
            p.obj(1, lambda o: o["animation"].pop("exit"))
            self.assertTrue(self.errors(p), "no exit")
        with MutatedProject() as p:
            p.obj(1, lambda o: o["animation"]["enter"].pop("duration"))
            self.assertTrue(self.errors(p), "no duration")
        with MutatedProject() as p:
            p.obj(1, lambda o: o["animation"]["enter"].update(delay=100))
            self.assertTrue(self.errors(p), "an unknown field")
        with MutatedProject() as p:
            p.obj(1, lambda o: o.pop("animation"))
            self.assertTrue(self.errors(p), "the whole animation missing")

    def test_an_exit_effect_on_an_object_that_never_goes_is_warned_about(self):
        with MutatedProject() as p:
            self.animate(p, exit={"effect": "fade", "duration": 500})
            found = [f for f in p.run() if f.rule == "animation-exit-never"]
            self.assertEqual([(f.severity, f.object_id) for f in found], [("warning", "obj-0002")])
        with MutatedProject() as p:
            self.animate(p, exit={"effect": "fade", "duration": 500})
            p.obj(1, lambda o: o["timing"].update(visibleFor=20000))
            self.assertEqual([f for f in p.run() if f.rule == "animation-exit-never"], [], "it does go, so the effect plays")
        with MutatedProject() as p:
            self.animate(p, enter={"effect": "zoom", "duration": 500})
            self.assertEqual([f for f in p.run() if f.rule == "animation-exit-never"], [], "an entrance needs no end time")


class BrokenExample(unittest.TestCase):
    """One assertion per row of examples/broken.osproj/EXPECTED-FAILURES.md."""

    @classmethod
    def setUpClass(cls):
        cls.f = validate.validate_project(EXAMPLES / "broken.osproj")

    def test_empty_alt_text(self):
        self.assertTrue(rules(self.f, "alt-text-missing", "obj-0001", "error"))

    def test_missing_asset(self):
        hits = rules(self.f, "asset-missing", "obj-0001", "error")
        self.assertTrue(hits)
        self.assertIn("does-not-exist.png", hits[0].detail)

    def test_decorative_with_alt(self):
        self.assertTrue(rules(self.f, "alt-text-on-decorative", "obj-0002", "error"))

    def test_click_without_key(self):
        self.assertTrue(rules(self.f, "click-without-key", "obj-0003", "error"))

    def test_trigger_target_missing(self):
        self.assertTrue(rules(self.f, "trigger-target-missing", "obj-0003", "error"))

    def test_undefined_variable(self):
        self.assertTrue(rules(self.f, "condition-unknown-variable", "obj-0003", "error"))

    def test_contrast(self):
        self.assertTrue(rules(self.f, "contrast", "obj-0003", "error"))

    def test_duplicate_object_id_reported_on_both(self):
        self.assertEqual(len(rules(self.f, "duplicate-object-id", "obj-0003", "error")), 2)

    def test_video_without_captions(self):
        self.assertTrue(rules(self.f, "media-needs-captions", "obj-0003", "error"))

    def test_missing_slide_file(self):
        self.assertTrue(rules(self.f, "slide-file-missing", severity="error"))

    def test_tab_order_gaps_is_a_warning(self):
        self.assertTrue(rules(self.f, "tab-order-gaps", "layer-base", validate.TAB_GAP_SEVERITY))

    def test_tab_order_duplicate(self):
        self.assertTrue(rules(self.f, "tab-order-duplicate", "obj-0001", "error"))

    def test_exit_code_is_nonzero(self):
        self.assertEqual(validate.main([str(EXAMPLES / "broken.osproj")]), 1)


class RulesNotInTheBrokenFixture(unittest.TestCase):
    def test_interactive_tab_order_zero(self):
        with MutatedProject() as p:
            p.obj(3, lambda o: o["accessibility"].__setitem__("tabOrder", 0))
            self.assertTrue(rules(p.run(), "not-keyboard-reachable", "obj-0004", "error"))

    def test_interactive_tab_order_null(self):
        with MutatedProject() as p:
            p.obj(3, lambda o: o["accessibility"].__setitem__("tabOrder", None))
            self.assertTrue(rules(p.run(), "not-keyboard-reachable", "obj-0004", "error"))

    def test_video_with_narration_script_is_fine(self):
        with MutatedProject() as p:
            (p.root / "assets" / "video").mkdir()
            (p.root / "assets" / "video" / "c.mp4").write_bytes(b"x")
            nar = {"script": "A clip.", "voice": "af_heart", "speed": 1.0, "lang": "en-US",
                   "pronunciations": [], "audioCache": None}

            def add_video(d):
                d["baseLayer"]["objects"].append({
                    "id": "obj-0050", "type": "video", "name": "Clip",
                    "geometry": {"x": 0, "y": 0, "width": 10, "height": 10, "rotation": 0, "z": 1},
                    "content": {"src": "assets/video/c.mp4", "captions": None}, "style": {},
                    "accessibility": {"altText": "A clip", "role": "img", "tabOrder": 4, "decorative": False},
                    "states": {}, "triggers": [], "narration": nar, "provenance": None, "simulation": None})
            p.slide1(add_video)
            self.assertEqual(rules(p.run(), "media-needs-captions"), [])

    def test_jump_to_unknown_slide(self):
        with MutatedProject() as p:
            p.obj(3, lambda o: o["triggers"][0].__setitem__("target", "slide-nope"))
            self.assertTrue(rules(p.run(), "trigger-target-missing", "obj-0004"))

    def test_set_variable_unknown_variable(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: o["triggers"].append(
                {"id": "trg-9", "event": "slideStart", "action": "setVariable", "target": "var-nope", "conditions": []}),
                slide="slides/slide-002.json")
            self.assertTrue(rules(p.run(), "trigger-target-missing", "obj-0010"))

    def test_quiz_feedback_layer_missing(self):
        with MutatedProject() as p:
            p.obj(1, lambda o: o["content"]["feedback"].__setitem__("correct", "layer-nope"),
                  slide="slides/slide-002.json")
            self.assertTrue(rules(p.run(), "trigger-target-missing", "obj-0011"))

    def test_large_text_gets_lower_contrast_threshold(self):
        with MutatedProject() as p:
            # 3.5:1 or so: fails for 18px text, passes for 30px text.
            def set_style(o, size):
                o["states"] = {}
                o["style"].update({"color": "#8a8a8a", "fill": "#ffffff", "fontSize": size})
            p.obj(3, lambda o: set_style(o, 18))
            self.assertTrue(rules(p.run(), "contrast", "obj-0004"))
            p.obj(3, lambda o: set_style(o, 30))
            self.assertEqual(rules(p.run(), "contrast", "obj-0004"), [])

    def test_contrast_checked_in_states(self):
        with MutatedProject() as p:
            p.obj(3, lambda o: o["states"]["hover"].__setitem__("style", {"fill": "#0b5fff", "color": "#0c60ff"}))
            self.assertTrue(rules(p.run(), "contrast", "obj-0004"))

    def test_newer_schema_version(self):
        with MutatedProject() as p:
            p.edit("project.json", lambda d: d.__setitem__("schemaVersion", "9.0.0"))
            self.assertTrue(rules(p.run(), "newer-schema", severity="error"))

    def test_slide_id_mismatch(self):
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("id", "slide-777"))
            self.assertTrue(rules(p.run(), "slide-id-mismatch"))

    def test_orphan_slide_file_warns(self):
        with MutatedProject() as p:
            shutil.copy(p.root / "slides" / "slide-001.json", p.root / "slides" / "slide-009.json")
            self.assertTrue(rules(p.run(), "slide-orphan", severity="warning"))

    def test_bad_json_is_reported_not_crashed(self):
        with MutatedProject() as p:
            (p.root / "slides" / "slide-001.json").write_text("{ nope", encoding="utf-8")
            self.assertTrue(rules(p.run(), "json-syntax", severity="error"))

    def test_asset_path_cannot_escape_project(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: (o.__setitem__("type", "image"),
                                o.__setitem__("content", {"src": "assets/../../outside.png"})))
            self.assertTrue(rules(p.run(), "asset-missing"))


class Narration(unittest.TestCase):
    def narr(self, p, fn):
        p.obj(1, lambda o: fn(o["narration"]))

    def test_unknown_voice(self):
        with MutatedProject() as p:
            self.narr(p, lambda n: n.__setitem__("voice", "zz_nobody"))
            self.assertTrue(rules(p.run(), "voice-unknown", "obj-0002", "error"))

    def test_invalid_ipa(self):
        with MutatedProject() as p:
            self.narr(p, lambda n: n["pronunciations"].append({"term": "Likert", "ipa": "<b>Likert</b>"}))
            self.assertTrue(rules(p.run(), "ipa-invalid", "obj-0002", "error"))

    def test_valid_ipa_accepted(self):
        with MutatedProject() as p:
            self.narr(p, lambda n: n["pronunciations"].append({"term": "Likert", "ipa": "ˈlɪkərt"}))
            self.assertEqual(rules(p.run(), "ipa-invalid"), [])

    def test_the_ordinary_letters_of_the_ipa_are_accepted(self):
        # a, th and ng sounds use letters outside the IPA blocks: cat, this, sing
        for ipa in ["kæt", "ðɪs", "sɪŋ", "bœf", "ˌɪntəɹˈnæʃənəl", "tʃɛr"]:
            with MutatedProject() as p:
                self.narr(p, lambda n, ipa=ipa: n["pronunciations"].append({"term": "word", "ipa": ipa}))
                self.assertEqual(rules(p.run(), "ipa-invalid"), [], ipa)

    def test_things_that_are_not_ipa_are_still_refused(self):
        for ipa in ["<b>", "word1", "A", "ab​c"]:
            with MutatedProject() as p:
                self.narr(p, lambda n, ipa=ipa: n["pronunciations"].append({"term": "word", "ipa": ipa}))
                self.assertTrue(rules(p.run(), "ipa-invalid", "obj-0002", "error"), ipa)

    def test_stale_cache_is_a_warning_not_an_error(self):
        with MutatedProject() as p:
            self.narr(p, lambda n: n.__setitem__("audioCache", {"hash": "sha256:" + "0" * 64,
                                                               "path": ".cache/narration/x.wav"}))
            f = p.run()
            self.assertTrue(rules(f, "narration-stale", "obj-0002", "warning"))
            self.assertTrue(rules(f, "narration-not-generated", "obj-0002", "warning"))
            self.assertEqual([x for x in f if x.severity == "error"], [])

    def test_matching_cache_with_file_present_is_clean(self):
        with MutatedProject() as p:
            data = json.loads((p.root / "slides" / "slide-001.json").read_text(encoding="utf-8"))
            n = data["baseLayer"]["objects"][1]["narration"]
            cache = {"hash": validate.narration_hash(n), "path": ".cache/narration/ok.wav"}
            self.narr(p, lambda nn: nn.__setitem__("audioCache", cache))
            (p.root / ".cache" / "narration").mkdir(parents=True)
            (p.root / ".cache" / "narration" / "ok.wav").write_bytes(b"x")
            f = p.run()
            self.assertEqual(rules(f, "narration-stale"), [])
            self.assertEqual(rules(f, "narration-not-generated"), [])

    def test_hash_changes_when_script_changes(self):
        n = {"script": "a", "voice": "af_heart", "speed": 1.0, "lang": "en-US", "pronunciations": []}
        m = dict(n, script="b")
        self.assertNotEqual(validate.narration_hash(n), validate.narration_hash(m))
        self.assertEqual(validate.narration_hash(n), validate.narration_hash(dict(n, speed=1)))


class Quiz(unittest.TestCase):
    def quiz(self, p, fn):
        p.obj(1, lambda o: fn(o["content"]["choices"]), slide="slides/slide-002.json")

    def test_the_example_quiz_has_one_correct_answer(self):
        with MutatedProject() as p:
            self.assertEqual(rules(p.run(), "quiz-correct-answer"), [])

    def test_no_correct_answer(self):
        with MutatedProject() as p:
            self.quiz(p, lambda cs: [c.__setitem__("correct", False) for c in cs])
            hit = rules(p.run(), "quiz-correct-answer", "obj-0011", "error")
            self.assertTrue(hit)
            self.assertIn("0 answers", hit[0].detail)

    def test_two_correct_answers(self):
        with MutatedProject() as p:
            self.quiz(p, lambda cs: cs[1].__setitem__("correct", True))
            self.assertTrue(rules(p.run(), "quiz-correct-answer", "obj-0011", "error"))

    def test_duplicate_answer_ids(self):
        with MutatedProject() as p:
            self.quiz(p, lambda cs: cs[1].__setitem__("id", "c1"))
            self.assertTrue(rules(p.run(), "quiz-duplicate-choice", "obj-0011", "error"))


class Interactions(unittest.TestCase):
    EXAMPLE = validate.ROOT / "examples" / "interactions.osproj"

    def run_edited(self, fn):
        """Validate a copy of the interactions example after changing its first interaction."""
        with tempfile.TemporaryDirectory() as tmp:
            dest = pathlib.Path(tmp) / "p.osproj"
            shutil.copytree(self.EXAMPLE, dest)
            path = dest / "slides" / "slide-001.json"
            slide = json.loads(path.read_text(encoding="utf-8"))
            obj = next(o for o in slide["baseLayer"]["objects"] if o["type"] == "interaction")
            fn(obj)
            path.write_text(json.dumps(slide, indent=2), encoding="utf-8")
            return validate.validate_project(dest), obj["id"]

    def test_the_example_has_no_problems(self):
        self.assertEqual([f for f in validate.validate_project(self.EXAMPLE) if f.severity == "error"], [])

    def test_a_picture_without_alt_text(self):
        def edit(o):
            o["content"]["items"][0]["image"] = {"src": "assets/images/a.png", "alt": "", "decorative": False}
        findings, oid = self.run_edited(edit)
        self.assertTrue(rules(findings, "interaction-image-alt", oid, "error"))

    def test_a_decorative_picture_with_alt_text(self):
        def edit(o):
            o["content"]["items"][0]["image"] = {"src": "assets/images/a.png", "alt": "A bridge", "decorative": True}
        findings, oid = self.run_edited(edit)
        self.assertTrue(rules(findings, "interaction-image-alt", oid, "error"))

    def test_a_picture_that_is_missing_from_the_project(self):
        def edit(o):
            o["content"]["items"][0]["image"] = {"src": "assets/images/gone.png", "alt": "A bridge", "decorative": False}
        findings, oid = self.run_edited(edit)
        self.assertTrue(rules(findings, "asset-missing", oid, "error"))

    def test_duplicate_item_ids(self):
        def edit(o):
            o["content"]["items"][1]["id"] = o["content"]["items"][0]["id"]
        findings, oid = self.run_edited(edit)
        self.assertTrue(rules(findings, "interaction-duplicate-item", oid, "error"))

    def test_an_interaction_must_be_reachable_by_keyboard(self):
        def edit(o):
            o["accessibility"]["tabOrder"] = 0
        findings, oid = self.run_edited(edit)
        self.assertTrue(rules(findings, "not-keyboard-reachable", oid, "error"))

    def test_the_number_of_items_must_suit_the_kind(self):
        def edit(o):
            o["content"]["kind"] = "pyramidStack"
            o["content"]["items"] = o["content"]["items"][:2]
        findings, oid = self.run_edited(edit)
        hit = rules(findings, "interaction-item-count", oid, "error")
        self.assertTrue(hit)
        self.assertIn("3 to 7", hit[0].detail)

        def fine(o):
            o["content"]["kind"] = "timeline"
        findings, oid = self.run_edited(fine)
        self.assertEqual(rules(findings, "interaction-item-count"), [])

    def test_an_interaction_with_no_items_or_an_unknown_kind_is_not_valid(self):
        for edit in (lambda o: o["content"].update(items=[]), lambda o: o["content"].update(kind="spinner")):
            findings, _ = self.run_edited(edit)
            self.assertTrue([f for f in findings if f.severity == "error"])


class ItemNarration(unittest.TestCase):
    """Each item of an interaction can have its own narration, and it is checked like an object's."""

    EXAMPLE = Interactions.EXAMPLE
    run_edited = Interactions.run_edited

    def narrated(self, **changes):
        n = {"script": "A short definition.", "voice": "af_heart", "speed": 1.0, "lang": "en-US",
             "pronunciations": [], "audioCache": None}
        n.update(changes)
        return n

    def edit_item(self, **changes):
        def edit(o):
            o["content"]["items"][1]["narration"] = self.narrated(**changes)
        return self.run_edited(edit)

    def test_an_item_with_good_narration_is_clean(self):
        findings, oid = self.edit_item()
        self.assertEqual([f for f in findings if f.severity == "error"], [])
        self.assertEqual(rules(findings, "narration-stale"), [])

    def test_an_item_may_have_none(self):
        findings, _ = self.run_edited(lambda o: o["content"]["items"][1].update(narration=None))
        self.assertEqual([f for f in findings if f.severity == "error"], [])

    def test_the_field_is_required_on_every_item(self):
        def edit(o):
            del o["content"]["items"][0]["narration"]
        findings, _ = self.run_edited(edit)
        self.assertTrue([f for f in findings if f.severity == "error"], "an item without a narration field is not valid")

    def test_an_unknown_voice_names_the_item(self):
        findings, oid = self.edit_item(voice="zz_nobody")
        hit = rules(findings, "voice-unknown", oid, "error")
        self.assertTrue(hit)
        self.assertIn("item '", hit[0].detail)

    def test_a_bad_pronunciation_is_refused(self):
        findings, oid = self.edit_item(pronunciations=[{"term": "Likert", "ipa": "<b>Likert</b>"}])
        self.assertTrue(rules(findings, "ipa-invalid", oid, "error"))

    def test_an_empty_script_is_not_valid(self):
        findings, _ = self.edit_item(script="   ")
        self.assertTrue([f for f in findings if f.severity == "error"])

    def test_stale_audio_on_an_item_is_a_warning(self):
        findings, oid = self.edit_item(audioCache={"hash": "sha256:" + "0" * 64, "path": ".cache/narration/x.wav"})
        self.assertTrue(rules(findings, "narration-stale", oid, "warning"))
        self.assertTrue(rules(findings, "narration-not-generated", oid, "warning"))
        self.assertEqual([f for f in findings if f.severity == "error"], [])


class Rules(unittest.TestCase):
    """The checks on triggers: what a rule compares, what it sets, and whether its event can happen."""

    def run_with(self, trigger, object_index=0):
        with MutatedProject() as p:
            p.edit("project.json", lambda d: d["variables"].extend([
                {"id": "var-path", "name": "path", "type": "string", "initial": ""},
                {"id": "var-score", "name": "score", "type": "number", "initial": 0},
                {"id": "var-flag", "name": "flag", "type": "boolean", "initial": False},
            ]))
            p.obj(object_index, lambda o: o["triggers"].append(trigger))
            return p.run()

    def trig(self, **over):
        t = {"id": "trg-9000", "event": "slideStart", "action": "setVariable", "target": "var-flag", "conditions": []}
        t.update(over)
        return t

    def test_a_condition_must_compare_a_variable_with_its_own_kind_of_value(self):
        bad = self.trig(conditions=[{"variable": "var-score", "operator": "equals", "value": "high"}])
        self.assertTrue(rules(self.run_with(bad), "condition-value-type", severity="error"))
        ok = self.trig(conditions=[{"variable": "var-score", "operator": "greaterThan", "value": 2}])
        self.assertEqual(rules(self.run_with(ok), "condition-value-type"), [])
        flag = self.trig(conditions=[{"variable": "var-flag", "operator": "equals", "value": 1}])
        self.assertTrue(rules(self.run_with(flag), "condition-value-type", severity="error"), "1 is a number, not true")

    def test_ordering_text_or_true_and_false_is_only_a_warning(self):
        t = self.trig(conditions=[{"variable": "var-path", "operator": "lessThan", "value": "m"}])
        self.assertTrue(rules(self.run_with(t), "condition-operator", severity="warning"))

    def test_setting_a_variable_needs_a_value_of_its_kind(self):
        self.assertTrue(rules(self.run_with(self.trig(target="var-score", value="five")), "trigger-value-type", severity="error"))
        self.assertTrue(rules(self.run_with(self.trig(target="var-path")), "trigger-value-type", severity="error"), "no value means true, which is not text")
        self.assertEqual(rules(self.run_with(self.trig(target="var-flag")), "trigger-value-type"), [], "no value sets a true or false variable to true")
        self.assertEqual(rules(self.run_with(self.trig(target="var-path", value="a")), "trigger-value-type"), [])

    def test_a_condition_no_answer_can_satisfy_is_a_warning(self):
        with MutatedProject() as p:
            p.edit("project.json", lambda d: d["variables"].extend([
                {"id": "var-pick", "name": "pick", "type": "string", "initial": ""},
                {"id": "var-rate", "name": "rate", "type": "number", "initial": 0},
            ]))
            radio = {"kind": "radio", "prompt": "Pick", "report": False, "variable": "var-pick",
                     "options": [{"id": "o1", "label": "A", "value": "a"}, {"id": "o2", "label": "B", "value": "b"}]}
            likert = {"kind": "likert", "prompt": "Rate", "report": False, "scale": ["No", "Yes"],
                      "rows": [{"id": "r1", "label": "Like it", "variable": "var-rate"}]}
            for index, content in enumerate((radio, likert), start=2):
                def add_input(slide, content=content, index=index):
                    base_obj = copy.deepcopy(slide["baseLayer"]["objects"][0])
                    base_obj.update(id=f"obj-09{index}", type="input", name="Input", content=content, triggers=[])
                    base_obj["accessibility"] = {"altText": content["prompt"], "role": "group", "tabOrder": 90 + index, "decorative": False}
                    slide["baseLayer"]["objects"].append(base_obj)
                p.edit("slides/slide-001.json", add_input)

            def rule(var, value):
                def go(slide):
                    slide["baseLayer"]["objects"][0]["triggers"].append({"id": f"trg-9{abs(hash(str(value))) % 100}", "event": "slideStart", "action": "setVariable", "target": "var-pick", "value": "a", "conditions": [{"variable": var, "operator": "equals", "value": value}]})
                p.edit("slides/slide-001.json", go)
            rule("var-pick", "option-1")
            rule("var-rate", 5)
            rule("var-pick", "b")
            rule("var-rate", 2)
            hits = rules(p.run(), "condition-never-true", severity="warning")
            self.assertEqual(len(hits), 2, "the text that matches no option, and the point beyond the scale")

    def test_an_event_that_cannot_happen_on_the_object_is_a_warning(self):
        findings = self.run_with(self.trig(event="mediaComplete"))
        self.assertTrue(rules(findings, "trigger-event-never", severity="warning"))
        self.assertEqual(rules(self.run_with(self.trig(event="slideStart")), "trigger-event-never"), [])


class Credits(unittest.TestCase):
    """assets.json: every place a file can have come from is accepted, and an unknown one is not."""

    def run_with(self, provider):
        with tempfile.TemporaryDirectory() as tmp:
            dest = pathlib.Path(tmp) / "p.osproj"
            shutil.copytree(validate.ROOT / "examples" / "minimal.osproj", dest)
            (dest / "assets" / "images").mkdir(parents=True, exist_ok=True)
            (dest / "assets" / "images" / "a.jpg").write_bytes(b"x")
            entry = {"path": "assets/images/a.jpg", "title": "A", "kind": "image",
                     "source": {"provider": provider, "url": "https://example.org/a", "creator": "Jane", "creatorUrl": "", "licence": "CC BY 4.0", "requiresCredit": True}}
            (dest / "assets.json").write_text(json.dumps({"assets": [entry]}), encoding="utf-8")
            return validate.validate_project(dest)

    def test_every_source_the_editor_can_search_or_link_to_is_accepted(self):
        for provider in ("pixabay", "unsplash", "pexels", "openverse", "wikimedia", "freesound", "mixkit", "svgrepo", "libreshot", "vecteezy", "other"):
            self.assertEqual([f for f in self.run_with(provider) if f.severity == "error"], [], provider)

    def test_a_source_nobody_has_heard_of_is_not(self):
        self.assertTrue([f for f in self.run_with("midjourney") if f.severity == "error"])


class Themes(unittest.TestCase):
    THEMES = sorted((validate.ROOT / "themes").glob("*.theme.json"))

    def theme(self, p, fn):
        p.edit("theme.json", fn)

    @staticmethod
    def themed(d):
        """Make a slide follow the theme instead of fixed colours."""
        d["background"] = None
        layers = [d["baseLayer"], *d["layers"]]
        for layer in layers:
            for o in layer["objects"]:
                o["states"] = {}
                st = o["style"]
                if o["type"] == "text":
                    st["color"] = "theme:color.good" if o["accessibility"]["role"] == "status" else "theme:color.text"
                elif o["type"] == "quizQuestion":
                    st["color"] = "theme:color.text"
                elif o["type"] == "button":
                    st.pop("color", None)
                    st.pop("fill", None)
                elif o["type"] == "shape":
                    st["fill"] = "theme:color.surface"

    def test_every_built_in_theme_is_valid_and_readable(self):
        """A project that uses theme colours reads well in every theme, light or dark."""
        self.assertGreaterEqual(len(self.THEMES), 8)
        for path in self.THEMES:
            with MutatedProject() as p:
                (p.root / "theme.json").write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
                p.edit("slides/slide-001.json", self.themed)
                p.edit("slides/slide-002.json", self.themed)
                errors = [f for f in p.run() if f.severity == "error"]
                self.assertEqual(errors, [], f"{path.name}: {[(f.rule, f.detail) for f in errors]}")

    def test_fixed_colours_do_not_follow_the_theme_and_the_validator_says_so(self):
        dark = next(t for t in self.THEMES if t.name.startswith("midnight"))
        with MutatedProject() as p:
            (p.root / "theme.json").write_text(dark.read_text(encoding="utf-8"), encoding="utf-8")
            self.assertTrue(rules(p.run(), "contrast", "obj-0001"), "fixed dark text on the dark Midnight theme")

    def test_a_project_with_no_theme_uses_the_default(self):
        with MutatedProject() as p:
            p.edit("project.json", lambda d: d.__setitem__("theme", None))
            self.assertEqual([f for f in p.run() if f.severity == "error"], [])

    def test_a_theme_missing_a_required_part_is_an_error(self):
        with MutatedProject() as p:
            self.theme(p, lambda d: d["colors"].pop("accent"))
            hits = [f for f in p.run() if f.file == "theme.json" and f.rule == "schema"]
            self.assertTrue(hits)

    def test_theme_colours_that_do_not_contrast_are_reported_on_the_theme(self):
        with MutatedProject() as p:
            self.theme(p, lambda d: d["colors"].__setitem__("text", "#fafafa"))
            hit = rules(p.run(), "theme-contrast", severity="error")
            self.assertTrue(hit)
            self.assertEqual(hit[0].file, "theme.json")

    def test_every_pair_of_theme_colours_is_checked(self):
        for fg, bg in validate.THEME_PAIRS:
            with MutatedProject() as p:
                self.theme(p, lambda d: d["colors"].__setitem__(fg, d["colors"][bg]))
                self.assertTrue(rules(p.run(), "theme-contrast"), f"{fg} on {bg} should be checked")

    def test_a_theme_colour_that_does_not_exist_is_an_error(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: o["style"].__setitem__("color", "theme:color.nope"))
            hit = rules(p.run(), "theme-token-unknown", "obj-0001", "error")
            self.assertTrue(hit)
            self.assertIn("theme:color.nope", hit[0].detail)

    def test_a_theme_font_that_does_not_exist_is_an_error(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: o["style"].__setitem__("fontFamily", "theme:font.nope"))
            self.assertTrue(rules(p.run(), "theme-token-unknown", "obj-0001"))

    def test_known_theme_values_are_accepted(self):
        with MutatedProject() as p:
            def use(o):
                o["style"].update({"color": "theme:color.text", "fontFamily": "theme:font.heading"})
            p.obj(0, use)
            self.assertEqual(rules(p.run(), "theme-token-unknown"), [])
            self.assertEqual(rules(p.run(), "contrast"), [])

    def test_a_slide_background_must_be_a_real_theme_background_or_a_hex_colour(self):
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("background", "theme:bg.nope"))
            self.assertTrue([f for f in p.run() if f.rule == "schema" and f.file == "slides/slide-001.json"])
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("background", "#101010"))
            self.assertTrue(rules(p.run(), "contrast", "obj-0001"), "dark text on a dark background")
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("background", "theme:bg.accent"))
            self.assertTrue(rules(p.run(), "contrast", "obj-0001"))

    def test_text_is_checked_against_the_slide_background(self):
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("background", "theme:bg.dark"))
            p.obj(0, lambda o: o["style"].__setitem__("color", "theme:color.onDark"))
            self.assertEqual(rules(p.run(), "contrast", "obj-0001"), [], "light text on the dark background passes")
            p.obj(0, lambda o: o["style"].__setitem__("color", "theme:color.text"))
            self.assertTrue(rules(p.run(), "contrast", "obj-0001", "error"), "dark text on the dark background fails")

    def test_text_with_no_colour_uses_the_theme_text_colour(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: o["style"].pop("color"))
            self.assertEqual(rules(p.run(), "contrast", "obj-0001"), [], "the theme's text colour on the theme's background")
            p.slide1(lambda d: d.__setitem__("background", "theme:bg.dark"))
            self.assertTrue(rules(p.run(), "contrast", "obj-0001"), "and fails on a dark slide")

    def test_a_gradient_background_is_checked_at_its_worst_point(self):
        with MutatedProject() as p:
            self.theme(p, lambda d: d["backgrounds"].__setitem__("default", {"type": "gradient", "from": "background", "to": "#222222", "angle": 90}))
            self.assertTrue(rules(p.run(), "contrast", "obj-0001"), "dark text fails where the gradient is dark")

    def test_a_button_without_its_own_colours_uses_the_theme_button_colours(self):
        with MutatedProject() as p:
            p.obj(3, lambda o: o["style"].clear())
            self.assertEqual(rules(p.run(), "contrast", "obj-0004"), [])
            self.theme(p, lambda d: d["colors"].__setitem__("accentStrong", "#ffffff"))
            self.assertTrue(rules(p.run(), "contrast", "obj-0004"), "white text on a white button")

    def test_theme_colours_work_as_fills(self):
        with MutatedProject() as p:
            def fill(o):
                o["style"].update({"fill": "theme:color.accentStrong", "color": "theme:color.onAccentStrong"})
            p.obj(3, fill)
            self.assertEqual(rules(p.run(), "contrast", "obj-0004"), [])
            p.obj(3, lambda o: o["style"].__setitem__("color", "theme:color.accentStrong"))
            self.assertTrue(rules(p.run(), "contrast", "obj-0004"), "button text the same colour as the button")


class AssetRoot(unittest.TestCase):
    def test_assets_are_found_under_a_separate_asset_root(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: (o.__setitem__("type", "image"),
                                o.__setitem__("content", {"src": "assets/images/pic.png"})))
            self.assertTrue(rules(p.run(), "asset-missing"))
            elsewhere = p.dir / "real"
            (elsewhere / "assets" / "images").mkdir(parents=True)
            (elsewhere / "assets" / "images" / "pic.png").write_bytes(b"x")
            found = validate.validate_project(p.root, asset_root=elsewhere)
            self.assertEqual(rules(found, "asset-missing"), [])

    def test_cli_accepts_asset_root(self):
        self.assertEqual(validate.main([str(EXAMPLES / "minimal.osproj"), "--asset-root", str(EXAMPLES / "minimal.osproj")]), 0)


class Provenance(unittest.TestCase):
    def test_duplicate_provenance(self):
        with MutatedProject() as p:
            prov = {"sourceDeck": "d", "slideIndex": 1, "shapeId": "S1", "importedAt": "2026-10-10T00:00:00Z"}
            p.obj(0, lambda o: o.__setitem__("provenance", copy.deepcopy(prov)))
            p.obj(1, lambda o: o.__setitem__("provenance", copy.deepcopy(prov)))
            self.assertEqual(len(rules(p.run(), "provenance-duplicate", severity="warning")), 2)


if __name__ == "__main__":
    unittest.main(verbosity=1)
