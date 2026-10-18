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


class Groups(unittest.TestCase):
    """A group is objects on one layer that share a tag. The editor makes them; the validator guards a file written by hand."""

    def test_two_objects_in_a_group_are_fine(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: o.__setitem__("group", "group-1"))
            p.obj(1, lambda o: o.__setitem__("group", "group-1"))
            found = p.run()
            self.assertEqual([f for f in found if f.rule.startswith("group-")], [])
            self.assertEqual([f for f in found if f.severity == "error"], [])

    def test_a_group_with_one_object_is_a_warning(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: o.__setitem__("group", "group-1"))
            hit = rules(p.run(), "group-single", severity="warning")
            self.assertTrue(hit)
            self.assertIn("group-1", hit[0].detail)

    def test_a_group_on_two_layers_is_an_error(self):
        with MutatedProject() as p:
            def on_two_layers(d):
                d["baseLayer"]["objects"][0]["group"] = "group-1"
                other = copy.deepcopy(d["baseLayer"]["objects"][1])
                other["id"] = "obj-9001"
                other["group"] = "group-1"
                d["layers"].append({"id": "layer-extra", "name": "Extra", "objects": [other]})
            p.slide1(on_two_layers)
            self.assertTrue(rules(p.run(), "group-split", severity="error"))

    def test_a_group_id_has_to_look_like_an_id(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: o.__setitem__("group", "Not An Id"))
            self.assertTrue([f for f in p.run() if f.severity == "error"])

    def test_no_group_is_the_normal_case(self):
        self.assertEqual([f for f in validate.validate_project(EXAMPLES / "minimal.osproj") if f.rule.startswith("group-")], [])


class QuestionKinds(unittest.TestCase):
    """Every kind of question has parts that must make sense, so there is a right answer a learner can give."""

    TYPED = {"questionType": "fillBlanks", "mode": "typed", "text": "The {1} flows past the {2}.",
             "blanks": [{"id": "1", "answers": ["river"]}, {"id": "2", "answers": ["town"]}], "wordBank": [], "caseSensitive": False}
    BANK = dict(TYPED, mode="dropdown", wordBank=["river", "town", "hill"])
    GOOD = {
        "multipleResponse": {"questionType": "multipleResponse", "choices": [
            {"id": "c1", "label": "A", "correct": True}, {"id": "c2", "label": "B", "correct": False}, {"id": "c3", "label": "C", "correct": True}]},
        "shortAnswer": {"questionType": "shortAnswer", "answers": ["Everest", "Mount Everest"], "caseSensitive": False},
        "numeric": {"questionType": "numeric", "min": 9.5, "max": 10.5},
        "typed": TYPED,
        "dropdown": BANK,
        "drag": dict(BANK, mode="drag"),
        "matching": {"questionType": "matching", "drag": False, "pairs": [
            {"id": "p1", "premise": "Email", "match": "Written"}, {"id": "p2", "premise": "Phone", "match": "Spoken"}], "extras": ["Silent"]},
        "sequencing": {"questionType": "sequencing", "drag": False, "items": [
            {"id": "s1", "text": "One"}, {"id": "s2", "text": "Two"}, {"id": "s3", "text": "Three"}]},
        "hotspot": {"questionType": "hotspot", "image": {"src": "assets/images/map.png", "alt": "A map of the site"}, "regions": [
            {"id": "r1", "label": "North gate", "x": 0, "y": 0, "width": 40, "height": 40, "correct": False},
            {"id": "r2", "label": "South gate", "x": 0, "y": 50, "width": 40, "height": 40, "correct": True}]},
    }

    def run_with(self, content, edit=None):
        """Validate the example with its question replaced, and a picture in the project for a hotspot to use."""
        with MutatedProject() as p:
            (p.root / "assets" / "images").mkdir(parents=True, exist_ok=True)
            (p.root / "assets" / "images" / "map.png").write_bytes(b"png")
            def swap(o):
                keep = {k: o["content"][k] for k in ("scoring", "feedback")}
                o["content"] = {**copy.deepcopy(content), **keep}
                if edit:
                    edit(o["content"])
            p.obj(1, swap, slide="slides/slide-002.json")
            return p.run()

    def test_every_kind_written_properly_has_no_errors(self):
        for name, content in self.GOOD.items():
            with self.subTest(name):
                self.assertEqual([f for f in self.run_with(content) if f.severity == "error"], [], name)

    def test_a_field_that_belongs_to_another_kind_is_not_allowed(self):
        found = self.run_with(self.GOOD["numeric"], lambda c: c.__setitem__("choices", []))
        self.assertTrue([f for f in found if f.severity == "error"])

    def test_multiple_response_needs_a_right_answer_and_warns_when_all_are_right(self):
        none = self.run_with(self.GOOD["multipleResponse"], lambda c: [x.__setitem__("correct", False) for x in c["choices"]])
        self.assertTrue(rules(none, "quiz-correct-answer", "obj-0011", "error"))
        everything = self.run_with(self.GOOD["multipleResponse"], lambda c: [x.__setitem__("correct", True) for x in c["choices"]])
        self.assertTrue(rules(everything, "quiz-all-correct", "obj-0011", "warning"))
        self.assertEqual(rules(everything, "quiz-correct-answer"), [])

    def test_two_right_answers_are_fine_for_multiple_response_but_not_multiple_choice(self):
        two = self.run_with(self.GOOD["multipleResponse"])
        self.assertEqual(rules(two, "quiz-correct-answer"), [])

    def test_short_answer_with_an_empty_accepted_answer(self):
        found = self.run_with(self.GOOD["shortAnswer"], lambda c: c["answers"].append("   "))
        self.assertTrue(rules(found, "quiz-empty-answer", "obj-0011", "error"))

    def test_numeric_range_the_wrong_way_round(self):
        found = self.run_with(self.GOOD["numeric"], lambda c: c.update(min=11, max=10))
        self.assertTrue(rules(found, "quiz-numeric-range", "obj-0011", "error"))
        self.assertEqual(rules(self.run_with(self.GOOD["numeric"], lambda c: c.update(min=5, max=5)), "quiz-numeric-range"), [], "an exact number is fine")

    def test_a_blank_in_the_sentence_with_no_answer(self):
        found = self.run_with(self.GOOD["typed"], lambda c: c.update(text=c["text"] + " Near {3}."))
        hit = rules(found, "quiz-blank-missing", "obj-0011", "error")
        self.assertTrue(hit)
        self.assertIn("{3}", hit[0].detail)

    def test_an_answer_for_a_blank_that_is_not_in_the_sentence(self):
        found = self.run_with(self.GOOD["typed"], lambda c: c.update(text="The {1} flows."))
        self.assertTrue(rules(found, "quiz-blank-unused", "obj-0011", "error"))

    def test_two_blanks_with_the_same_id(self):
        found = self.run_with(self.GOOD["typed"], lambda c: c["blanks"][1].__setitem__("id", "1"))
        self.assertTrue(rules(found, "quiz-duplicate-blank", "obj-0011", "error"))

    def test_a_right_word_that_is_not_in_the_word_bank(self):
        for name in ("dropdown", "drag"):
            found = self.run_with(self.GOOD[name], lambda c: c.update(wordBank=["river", "hill"]))
            hit = rules(found, "quiz-word-bank", "obj-0011", "error")
            self.assertTrue(hit, name)
            self.assertIn("town", hit[0].detail)

    def test_a_word_bank_that_repeats_a_word_whatever_its_capitals(self):
        found = self.run_with(self.GOOD["dropdown"], lambda c: c["wordBank"].append("River"))
        self.assertTrue(rules(found, "quiz-word-bank-duplicate", "obj-0011", "error"))

    def test_typed_blanks_need_no_word_bank(self):
        self.assertEqual(rules(self.run_with(self.GOOD["typed"]), "quiz-word-bank"), [])

    def test_matching_with_two_matches_that_read_the_same(self):
        found = self.run_with(self.GOOD["matching"], lambda c: c["extras"].append("spoken"))
        self.assertTrue(rules(found, "quiz-match-duplicate", "obj-0011", "error"))

    def test_matching_pairs_must_have_different_ids(self):
        found = self.run_with(self.GOOD["matching"], lambda c: c["pairs"][1].__setitem__("id", "p1"))
        self.assertTrue(rules(found, "quiz-duplicate-pair", "obj-0011", "error"))

    def test_sequencing_items_must_have_different_ids_and_should_read_differently(self):
        found = self.run_with(self.GOOD["sequencing"], lambda c: c["items"][1].__setitem__("id", "s1"))
        self.assertTrue(rules(found, "quiz-duplicate-item", "obj-0011", "error"))
        same = self.run_with(self.GOOD["sequencing"], lambda c: c["items"][1].__setitem__("text", "one"))
        self.assertTrue(rules(same, "quiz-item-duplicate", "obj-0011", "warning"))

    def test_a_hotspot_picture_needs_alt_text(self):
        found = self.run_with(self.GOOD["hotspot"], lambda c: c["image"].__setitem__("alt", "  "))
        self.assertTrue(rules(found, "quiz-hotspot-alt", "obj-0011", "error"))

    def test_a_hotspot_needs_a_right_area_and_a_label_for_every_area(self):
        none = self.run_with(self.GOOD["hotspot"], lambda c: [r.__setitem__("correct", False) for r in c["regions"]])
        self.assertTrue(rules(none, "quiz-correct-answer", "obj-0011", "error"))
        unlabelled = self.run_with(self.GOOD["hotspot"], lambda c: c["regions"][0].__setitem__("label", " "))
        self.assertTrue(rules(unlabelled, "quiz-region-label", "obj-0011", "error"))
        twins = self.run_with(self.GOOD["hotspot"], lambda c: c["regions"][1].__setitem__("label", "north gate"))
        self.assertTrue(rules(twins, "quiz-region-duplicate", "obj-0011", "warning"))

    def test_a_hotspot_area_must_be_inside_the_picture(self):
        found = self.run_with(self.GOOD["hotspot"], lambda c: c["regions"][0].update(x=80, width=40))
        self.assertTrue(rules(found, "quiz-region-bounds", "obj-0011", "error"))

    def test_a_hotspot_picture_that_is_not_in_the_project(self):
        found = self.run_with(self.GOOD["hotspot"], lambda c: c["image"].__setitem__("src", "assets/images/missing.png"))
        self.assertTrue(rules(found, "asset-missing", "obj-0011", "error"))


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


class EngineVoices(unittest.TestCase):
    """A narration's voice names its engine: a bare name is Kokoro's, and another engine's voice is 'engine:voice'."""

    def with_voice(self, voice, credits_on=True):
        with MutatedProject() as p:
            p.obj(1, lambda o: o["narration"].__setitem__("voice", voice))
            p.edit("project.json", lambda d: d.__setitem__("credits", credits_on))
            return p.run()

    def test_a_voice_of_each_engine_is_accepted(self):
        for voice in ("af_heart", "openai:alloy", "openai:cedar", "tone-voice:low", "my-plugin:narrator.v2"):
            self.assertEqual(rules(self.with_voice(voice), "voice-unknown"), [], voice)

    def test_a_voice_that_cannot_be_right_is_not(self):
        for voice in ("zz_nobody", "openai:alloyy", "openai:", "plug:../../x", "Tone:low", "tone voice:low", "a:b", ":low", "x:y:z", "openai:alloy extra"):
            self.assertTrue(rules(self.with_voice(voice), "voice-unknown", "obj-0002", "error"), voice)

    def test_a_person_in_the_cast_can_have_a_voice_of_any_engine(self):
        with MutatedProject() as p:
            p.edit("project.json", lambda d: d.__setitem__("characters", [{"id": "ana", "name": "Ana", "role": "", "voice": "openai:coral", "picture": None}]))
            self.assertEqual(rules(p.run(), "voice-unknown"), [])
            p.edit("project.json", lambda d: d["characters"][0].__setitem__("voice", "openai:nobody"))
            self.assertTrue(rules(p.run(), "voice-unknown", severity="error"))

    def test_a_service_voice_needs_the_credits_page_so_listeners_are_told(self):
        hit = rules(self.with_voice("openai:alloy", credits_on=False), "voice-credit-page-off", severity="warning")
        self.assertEqual(len(hit), 1)
        self.assertIn("OpenAI", hit[0].message)
        self.assertEqual(rules(self.with_voice("openai:alloy", credits_on=True), "voice-credit-page-off"), [])

    def test_other_voices_do_not_raise_it(self):
        # A voice of an engine OpenStage no longer has is read like any plugin's: well formed, and nothing said about the credits page.
        for voice in ("af_heart", "tone-voice:low", "elevenlabs:21m00Tcm4TlvDq8ikWAM"):
            self.assertEqual(rules(self.with_voice(voice, credits_on=False), "voice-credit-page-off"), [], voice)


class GeneratedCredits(unittest.TestCase):
    """assets.json: a picture or sound an AI service made says so, and from what words and when."""

    RECORD = {"service": "openai", "model": "gpt-image-1", "prompt": "A red barn in the snow", "madeAt": "2026-10-14T10:30:00Z"}

    def findings(self, credits_on=True, **changes):
        source = {"provider": "generated", "url": "https://openai.com/", "creator": "OpenAI (gpt-image-1)", "creatorUrl": "",
                  "licence": "AI-generated; the service's terms of use apply", "requiresCredit": True, "generated": dict(self.RECORD)}
        for k, v in changes.items():
            if v is None:
                source.pop(k, None)
            else:
                source[k] = v
        with MutatedProject() as p:
            (p.root / "assets" / "images").mkdir(parents=True, exist_ok=True)
            (p.root / "assets" / "images" / "barn.png").write_bytes(b"x")
            entry = {"path": "assets/images/barn.png", "title": "A red barn", "kind": "image", "source": source}
            (p.root / "assets.json").write_text(json.dumps({"assets": [entry]}), encoding="utf-8")
            p.edit("project.json", lambda d: d.__setitem__("credits", credits_on))
            # Something on a slide that mentions the file, which is all the check for 'in use' looks at.
            p.obj(0, lambda o: o.__setitem__("name", "Uses assets/images/barn.png"))
            return p.run()

    def test_a_generated_picture_with_its_record_is_valid(self):
        self.assertEqual([f for f in self.findings() if f.severity == "error"], [])

    def test_the_record_is_required_for_a_generated_source(self):
        self.assertTrue([f for f in self.findings(generated=None) if f.severity == "error"])

    def test_the_record_belongs_to_generated_sources_only(self):
        self.assertTrue([f for f in self.findings(provider="other") if f.severity == "error"])

    def test_the_record_must_be_complete(self):
        for field in ("service", "model", "prompt", "madeAt"):
            record = {k: v for k, v in self.RECORD.items() if k != field}
            self.assertTrue([f for f in self.findings(generated=record) if f.severity == "error"], field)

    def test_a_blank_prompt_or_a_made_up_time_is_not_a_record(self):
        self.assertTrue([f for f in self.findings(generated={**self.RECORD, "prompt": "   "}) if f.severity == "error"])
        self.assertTrue([f for f in self.findings(generated={**self.RECORD, "madeAt": "yesterday"}) if f.severity == "error"])
        self.assertTrue([f for f in self.findings(generated={**self.RECORD, "service": "Open AI!"}) if f.severity == "error"])

    def test_the_credits_page_must_be_on_to_tell_people_it_was_made_by_an_ai(self):
        hit = rules(self.findings(credits_on=False), "credit-page-off", severity="warning")
        self.assertEqual(len(hit), 1)
        self.assertEqual(rules(self.findings(credits_on=True), "credit-page-off"), [])


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


class AddingToAVariable(unittest.TestCase):
    """A rule can add to a number variable, such as a count of tries."""

    def run_with(self, trigger, index=0):
        with MutatedProject() as p:
            p.obj(index, lambda o: o["triggers"].append(trigger))
            return p.run()

    def trig(self, **over):
        t = {"id": "trg-9100", "event": "slideStart", "action": "setVariable", "target": "var-attempts", "operation": "add", "value": 1, "conditions": []}
        t.update(over)
        return t

    def test_adding_to_a_number_is_fine_with_or_without_an_amount(self):
        for trigger in (self.trig(), self.trig(value=-2), self.trig(value=0.5)):
            self.assertEqual([f for f in self.run_with(trigger) if f.severity == "error"], [])
        without = self.trig()
        del without["value"]
        self.assertEqual([f for f in self.run_with(without) if f.severity == "error"], [], "no amount means add 1")

    def test_a_variable_that_is_not_a_number_cannot_be_added_to(self):
        hit = rules(self.run_with(self.trig(target="var-answered")), "trigger-operation-type", severity="error")
        self.assertTrue(hit)
        self.assertIn("boolean", hit[0].detail)

    def test_the_amount_must_be_a_number(self):
        self.assertTrue(rules(self.run_with(self.trig(value="one")), "trigger-value-type", severity="error"))
        self.assertTrue(rules(self.run_with(self.trig(value=True)), "trigger-value-type", severity="error"))

    def test_only_setting_a_variable_can_add(self):
        bad = self.trig(action="showLayer", target="layer-base")
        del bad["value"]
        self.assertTrue(rules(self.run_with(bad), "trigger-operation-action", severity="error"))

    def test_an_operation_has_to_be_set_or_add(self):
        self.assertTrue([f for f in self.run_with(self.trig(operation="multiply")) if f.severity == "error"])

    def test_the_click_and_the_key_press_of_a_rule_have_to_do_the_same_thing(self):
        click = {"id": "trg-9101", "event": "click", "action": "setVariable", "target": "var-attempts", "operation": "add", "value": 1, "conditions": []}
        key = dict(click, id="trg-9102", event="keyActivate")
        with MutatedProject() as p:
            p.obj(3, lambda o: o["triggers"].extend([click, key]))
            self.assertEqual(rules(p.run(), "click-without-key"), [])
        with MutatedProject() as p:
            p.obj(3, lambda o: o["triggers"].extend([click, dict(key, operation="set")]))
            self.assertTrue(rules(p.run(), "click-without-key", severity="error"), "adding is not the same as setting")


class Hotspots(unittest.TestCase):
    """A hotspot is a transparent button over a picture: named by its alt text, no content of its own, big enough to press."""

    def hotspot(self, p, **over):
        def make(d):
            spot = copy.deepcopy(d["baseLayer"]["objects"][3])
            spot.update({"id": "obj-9200", "name": "Target area", "type": "hotspot", "content": {}, "triggers": []})
            spot["geometry"].update({"x": 300, "y": 300, "width": 160, "height": 90})
            spot["accessibility"].update({"altText": "The Save button", "role": "button", "tabOrder": 4})
            spot.update(over)
            d["baseLayer"]["objects"].append(spot)
        p.slide1(make)

    def test_a_named_hotspot_of_a_good_size_is_fine(self):
        with MutatedProject() as p:
            self.hotspot(p)
            found = p.run()
            self.assertEqual([f for f in found if f.severity == "error"], [])
            self.assertEqual([f for f in found if f.rule.startswith("hotspot")], [])

    def test_a_hotspot_needs_a_name(self):
        with MutatedProject() as p:
            self.hotspot(p, accessibility={"altText": "", "role": "button", "tabOrder": 4, "decorative": False})
            self.assertTrue([f for f in p.run() if f.severity == "error"])

    def test_a_hotspot_cannot_be_decorative(self):
        with MutatedProject() as p:
            self.hotspot(p, accessibility={"altText": "", "role": "presentation", "tabOrder": 4, "decorative": True})
            self.assertTrue(rules(p.run(), "hotspot-decorative", severity="error"))

    def test_a_hotspot_needs_to_be_reachable_by_keyboard(self):
        with MutatedProject() as p:
            self.hotspot(p, accessibility={"altText": "The Save button", "role": "button", "tabOrder": 0, "decorative": False})
            self.assertTrue([f for f in p.run() if f.severity == "error"])

    def test_a_hotspot_smaller_than_24_pixels_is_an_error(self):
        with MutatedProject() as p:
            self.hotspot(p)
            p.slide1(lambda d: d["baseLayer"]["objects"][-1]["geometry"].update({"width": 20, "height": 90}))
            self.assertTrue(rules(p.run(), "hotspot-too-small", severity="error"))

    def test_a_hotspot_that_could_fall_under_24_pixels_when_scaled_is_a_warning(self):
        with MutatedProject() as p:
            self.hotspot(p)
            p.slide1(lambda d: d["baseLayer"]["objects"][-1]["geometry"].update({"width": 30, "height": 30}))
            found = p.run()
            self.assertTrue(rules(found, "hotspot-small", severity="warning"))
            self.assertEqual(rules(found, "hotspot-too-small"), [])

    def test_content_in_a_hotspot_is_not_allowed(self):
        with MutatedProject() as p:
            self.hotspot(p, content={"shape": "rectangle"})
            self.assertTrue([f for f in p.run() if f.severity == "error"], "the schema says a hotspot has no content")

    def test_a_hotspot_can_cause_click_rules(self):
        with MutatedProject() as p:
            click = {"id": "trg-9201", "event": "click", "action": "showLayer", "target": "layer-base", "conditions": []}
            self.hotspot(p, triggers=[click, dict(click, id="trg-9202", event="keyActivate")])
            found = p.run()
            self.assertEqual(rules(found, "trigger-event-never"), [])
            self.assertEqual(rules(found, "click-without-key"), [])


class CaptureProvenance(unittest.TestCase):
    """Objects and slides the Capture module makes name the capture and the step they came from."""

    STEP = {"sourceCapture": "capture-2026-10-13", "stepId": "step-3"}

    def test_an_object_and_a_slide_can_name_a_capture_step(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: o.__setitem__("provenance", dict(self.STEP, capturedAt="2026-10-13T09:30:00Z")))
            p.slide1(lambda d: d.__setitem__("provenance", dict(self.STEP)))
            found = p.run()
            self.assertEqual([f for f in found if f.severity == "error"], [])
            self.assertEqual(rules(found, "provenance-duplicate"), [])

    def test_several_objects_of_one_step_are_expected(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: o.__setitem__("provenance", dict(self.STEP)))
            p.obj(1, lambda o: o.__setitem__("provenance", dict(self.STEP)))
            self.assertEqual(rules(p.run(), "provenance-duplicate"), [])

    def test_two_slides_for_one_step_are_a_duplicate(self):
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("provenance", dict(self.STEP)))
            p.edit("slides/slide-002.json", lambda d: d.__setitem__("provenance", dict(self.STEP)))
            self.assertEqual(len(rules(p.run(), "provenance-duplicate", severity="warning")), 2)

    def test_a_capture_step_needs_both_names(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: o.__setitem__("provenance", {"sourceCapture": "capture-1"}))
            self.assertTrue([f for f in p.run() if f.severity == "error"])
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("provenance", {"stepId": "step-1"}))
            self.assertTrue([f for f in p.run() if f.severity == "error"])

    BASE = {
        "name": "Step 1: Click the Save button.",
        "picture": {"src": "assets/images/lesson-step-1.png", "width": 1920, "height": 1080, "take": 1, "shotMs": 950},
        "objects": {
            "heading": {"id": "obj-0101", "layer": "layer-base", "fields": {"name": "0123456789abcd", "geometry": "fedcba98765432", "content": "0011223344556a"}},
            "layer-hint/message": {"id": "obj-0102", "layer": "layer-hint", "fields": {"name": "fedcba98765432"}},
        },
    }

    def test_a_slide_can_record_what_the_capture_module_made_for_it(self):
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("provenance", dict(self.STEP, base=json.loads(json.dumps(self.BASE)))))
            self.assertEqual([f for f in p.run() if f.severity == "error" and f.rule == "schema"], [])
        with MutatedProject() as p:
            base = json.loads(json.dumps(self.BASE))
            base["picture"] = None
            p.slide1(lambda d: d.__setitem__("provenance", dict(self.STEP, base=base)))
            self.assertEqual(rules(p.run(), "schema"), [], "a slide made with no picture has none")

    def test_a_malformed_base_is_an_error(self):
        broken = {
            "no name": lambda b: b.pop("name"),
            "no picture entry": lambda b: b.pop("picture"),
            "no objects": lambda b: b.pop("objects"),
            "a part with no fingerprints": lambda b: b["objects"]["heading"].pop("fields"),
            "a part with an empty set of fingerprints": lambda b: b["objects"]["heading"].__setitem__("fields", {}),
            "a fingerprint field named in capitals": lambda b: b["objects"]["heading"]["fields"].__setitem__("Name", "abc"),
            "a fingerprint that is not text": lambda b: b["objects"]["heading"]["fields"].__setitem__("name", 5),
            "a part with no layer": lambda b: b["objects"]["heading"].pop("layer"),
            "a part with an empty id": lambda b: b["objects"]["heading"].__setitem__("id", ""),
            "a part named in capitals": lambda b: b["objects"].__setitem__("Heading", {"id": "x", "layer": "l", "fields": {"name": "h"}}),
            "a picture outside the assets": lambda b: b["picture"].__setitem__("src", "elsewhere/x.png"),
            "a picture with no size": lambda b: b["picture"].pop("width"),
            "a picture of take zero": lambda b: b["picture"].__setitem__("take", 0),
            "something else in it": lambda b: b.__setitem__("extra", 1),
        }
        for what, change in broken.items():
            with MutatedProject() as p:
                base = json.loads(json.dumps(self.BASE))
                change(base)
                p.slide1(lambda d: d.__setitem__("provenance", dict(self.STEP, base=base)))
                self.assertTrue(rules(p.run(), "schema"), what)

    def test_a_slide_does_not_take_deck_provenance(self):
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("provenance", {"sourceDeck": "d", "slideIndex": 1, "shapeId": "S1", "importedAt": "2026-10-10T00:00:00Z"}))
            self.assertTrue([f for f in p.run() if f.severity == "error"])

    def test_capture_objects_do_not_trigger_the_mixed_warning(self):
        """Only objects from an imported deck are re-synced against a deck, so a slide of capture objects and the author's own is normal."""
        with MutatedProject() as p:
            on_slide_1 = lambda found: [f for f in rules(found, "provenance-mixed") if f.file == "slides/slide-001.json"]
            p.slide1(lambda d: [o.__setitem__("provenance", None) for o in d["baseLayer"]["objects"]])
            self.assertEqual(on_slide_1(p.run()), [])
            p.obj(0, lambda o: o.__setitem__("provenance", dict(self.STEP)))
            self.assertEqual(on_slide_1(p.run()), [])


class CaptureMaterial(unittest.TestCase):
    """Raw recording material in the project would be handed to every learner, so it is flagged, and a project can leave things out."""

    def put(self, p, rel, text="{}"):
        path = p.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def test_a_clean_project_has_no_warning(self):
        with MutatedProject() as p:
            self.assertEqual(rules(p.run(), "capture-material-in-project"), [])

    def test_an_interaction_log_in_the_project_is_a_warning(self):
        with MutatedProject() as p:
            self.put(p, "recording/events.jsonl")
            hit = rules(p.run(), "capture-material-in-project", severity="warning")
            self.assertEqual(len(hit), 1)
            self.assertIn("recording/events.jsonl", hit[0].detail)
            self.assertIn("sourceExclude", hit[0].detail)

    def test_a_capture_folder_is_one_warning_not_one_per_file(self):
        with MutatedProject() as p:
            self.put(p, "capture/events.jsonl")
            self.put(p, "capture/screen.mp4", "x")
            self.put(p, "capture/frames/1.png", "x")
            self.assertEqual(len(rules(p.run(), "capture-material-in-project")), 1)

    def test_listing_it_in_source_exclude_clears_the_warning(self):
        with MutatedProject() as p:
            self.put(p, "capture/events.jsonl")
            p.edit("project.json", lambda d: d.__setitem__("sourceExclude", ["capture"]))
            found = p.run()
            self.assertEqual(rules(found, "capture-material-in-project"), [])
            self.assertEqual([f for f in found if f.severity == "error"], [])

    def test_under_assets_it_is_published_with_the_course_so_excluding_it_is_not_enough(self):
        with MutatedProject() as p:
            self.put(p, "assets/capture/events.jsonl")
            p.edit("project.json", lambda d: d.__setitem__("sourceExclude", ["capture"]))
            hit = rules(p.run(), "capture-material-in-project", severity="warning")
            self.assertEqual(len(hit), 1)
            self.assertIn("published with the course", hit[0].detail)

    def test_the_cache_folder_is_not_searched(self):
        with MutatedProject() as p:
            self.put(p, ".cache/capture/events.jsonl")
            self.assertEqual(rules(p.run(), "capture-material-in-project"), [])

    def test_source_exclude_entries_must_be_plain_paths(self):
        for bad in ("../outside", "/absolute", "a" + chr(92) + "b", "a/../b", ""):
            with MutatedProject() as p:
                p.edit("project.json", lambda d: d.__setitem__("sourceExclude", [bad]))
                self.assertTrue([f for f in p.run() if f.severity == "error"], repr(bad))

    def test_the_exclusion_rule_matches_the_shared_cases(self):
        cases = json.loads((validate.ROOT / "tools" / "source-exclude-cases.json").read_text(encoding="utf-8"))["cases"]
        self.assertGreater(len(cases), 10)
        for c in cases:
            self.assertEqual(validate.source_excluded(c["path"], c["patterns"]), c["excluded"], c)


class AudioDescription(unittest.TestCase):
    """A video's audio description: cues that say what the picture shows at a time, each spoken as well as written."""

    @staticmethod
    def cue(cid="ad-1", time=4500, text="A woman opens a laptop on a kitchen table.", pause=True, voiced=True):
        narration = {"script": text or "x", "voice": "af_heart", "speed": 1.0, "lang": "en-US", "pronunciations": [], "audioCache": None} if voiced else None
        return {"id": cid, "time": time, "text": text, "pause": pause, "narration": narration}

    def video(self, p, cues, **over):
        def make(d):
            v = copy.deepcopy(d["baseLayer"]["objects"][0])
            v.update({"id": "obj-9300", "name": "Welcome video", "type": "video", "triggers": []})
            v["content"] = {"src": "assets/video/welcome.mp4", "captions": "assets/captions/welcome.vtt"}
            if cues is not None:
                v["content"]["description"] = {"cues": cues}
            v["accessibility"].update({"altText": "Welcome from the instructor", "role": "presentation", "tabOrder": 9})
            v.update(over)
            d["baseLayer"]["objects"].append(v)
        p.slide1(make)

    def found(self, p):
        return [f for f in p.run() if f.rule.startswith("description-") or f.rule in ("voice-unknown", "ipa-invalid", "narration-stale")]

    def test_a_spoken_description_is_fine(self):
        with MutatedProject() as p:
            self.video(p, [self.cue(), self.cue("ad-2", 12000, "She types the course code.", pause=False)])
            self.assertEqual(self.found(p), [])
            self.assertEqual([f for f in p.run() if f.severity == "error" and "asset" not in f.rule], [])

    def test_a_video_with_no_description_is_unchanged(self):
        with MutatedProject() as p:
            self.video(p, None)
            self.assertEqual(self.found(p), [])

    def test_a_description_with_no_words_is_an_error(self):
        with MutatedProject() as p:
            self.video(p, [self.cue(text="   ", voiced=False)])
            hit = rules(p.run(), "description-text-missing", severity="error")
            self.assertTrue(hit)
            self.assertIn("0:04", hit[0].detail)

    def test_a_description_that_is_only_written_is_a_warning_that_mentions_the_standard(self):
        with MutatedProject() as p:
            self.video(p, [self.cue(voiced=False)])
            hit = rules(p.run(), "description-not-voiced", severity="warning")
            self.assertEqual(len(hit), 1)
            self.assertIn("1.2.5", hit[0].detail)

    def test_two_descriptions_cannot_share_an_id(self):
        with MutatedProject() as p:
            self.video(p, [self.cue("ad-1", 1000), self.cue("ad-1", 9000)])
            self.assertTrue(rules(p.run(), "description-duplicate-id", severity="error"))

    def test_the_voice_of_a_description_is_checked_like_any_narration(self):
        with MutatedProject() as p:
            bad = self.cue()
            bad["narration"]["voice"] = "no_such_voice"
            self.video(p, [bad])
            hit = rules(p.run(), "voice-unknown", severity="error")
            self.assertTrue(hit)
            self.assertIn("audio description at 0:04", hit[0].detail)

    def test_a_description_whose_audio_is_out_of_date_is_a_warning(self):
        with MutatedProject() as p:
            old = self.cue()
            old["narration"]["audioCache"] = {"hash": "sha256:" + "0" * 64, "path": ".cache/narration/x.wav"}
            self.video(p, [old])
            self.assertTrue(rules(p.run(), "narration-stale", severity="warning"))

    def test_an_audio_clip_cannot_have_one(self):
        with MutatedProject() as p:
            self.video(p, [self.cue()], type="audio")
            self.assertTrue(rules(p.run(), "description-on-audio", severity="error"))

    def test_the_parts_of_a_description_must_be_well_formed(self):
        for bad in (
            [],                                                      # an empty list is no description
            [dict(self.cue(), time=-1)],
            [dict(self.cue(), time=1.5)],
            [dict(self.cue(), pause="yes")],
            [dict(self.cue(), id="Not An Id")],
            [{k: v for k, v in self.cue().items() if k != "pause"}],
            [dict(self.cue(), extra=1)],
        ):
            with MutatedProject() as p:
                self.video(p, bad)
                self.assertTrue([f for f in p.run() if f.severity == "error" and "asset" not in f.rule], repr(bad)[:80])

    def test_the_speech_tool_finds_a_descriptions_narration_under_the_objects_id_and_the_cues(self):
        import narrate
        with MutatedProject() as p:
            self.video(p, [self.cue("ad-1"), self.cue("ad-2", 9000, "A second description.", voiced=False), self.cue("ad-3", 20000, "A third.")])
            keys = [key for _, key, _ in narrate.narrated_objects(p.root)]
            self.assertIn("obj-9300/ad-1", keys)
            self.assertIn("obj-9300/ad-3", keys)
            self.assertNotIn("obj-9300/ad-2", keys, "a description with no voice has nothing to make")


class ThemeLogoRules(unittest.TestCase):
    """A theme's logo is a picture on every slide: it needs a name (or to be decorative), a file, and room."""

    def logo(self, **over):
        logo = {"src": "assets/images/logo.png", "alt": "New Paltz logo", "decorative": False, "corner": "bottom-right", "width": 120, "height": 60}
        logo.update(over)
        return logo

    def with_logo(self, p, logo, file=True):
        if file:
            path = p.root / "assets" / "images"
            path.mkdir(parents=True, exist_ok=True)
            (path / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        p.edit("theme.json", lambda t: t.__setitem__("logo", logo))
        return p.run()

    def ours(self, found):
        return [f for f in found if f.rule.startswith("theme-logo")]

    def test_a_named_logo_with_a_file_in_a_free_corner_is_fine(self):
        with MutatedProject() as p:
            found = self.with_logo(p, self.logo())
            self.assertEqual(self.ours(found), [])
            self.assertEqual([f for f in found if f.severity == "error"], [])

    def test_a_theme_without_a_logo_is_the_normal_case(self):
        with MutatedProject() as p:
            self.assertEqual(self.ours(p.run()), [])

    def test_a_logo_needs_alt_text_or_to_be_decorative(self):
        with MutatedProject() as p:
            hit = rules(self.with_logo(p, self.logo(alt="  ")), "theme-logo-alt", severity="error")
            self.assertTrue(hit)
            self.assertIn("every slide", hit[0].detail)
        with MutatedProject() as p:
            found = self.with_logo(p, self.logo(alt="", decorative=True))
            self.assertEqual(self.ours(found), [], "decorative with no alt text is fine")

    def test_a_decorative_logo_must_not_have_alt_text(self):
        with MutatedProject() as p:
            self.assertTrue(rules(self.with_logo(p, self.logo(decorative=True)), "theme-logo-decorative-alt", severity="error"))

    def test_the_logo_file_must_exist(self):
        with MutatedProject() as p:
            self.assertTrue(rules(self.with_logo(p, self.logo(), file=False), "theme-logo-missing", severity="error"))

    def test_the_parts_of_a_logo_must_be_well_formed(self):
        for bad in (
            self.logo(corner="middle"),
            self.logo(width=10),
            self.logo(width=900),
            self.logo(height=300),
            self.logo(width=120.5),
            self.logo(src="elsewhere/logo.png"),
            self.logo(src="assets/../../secret.png"),
            self.logo(decorative="no"),
            {k: v for k, v in self.logo().items() if k != "height"},
            dict(self.logo(), extra=1),
        ):
            with MutatedProject() as p:
                found = self.with_logo(p, bad, file=False)
                self.assertTrue([f for f in found if f.severity == "error" and f.rule != "theme-logo-missing"], repr(bad)[:80])

    def test_content_in_the_logos_corner_is_a_warning_naming_it(self):
        with MutatedProject() as p:
            # minimal's heading starts at 80,72, which is inside a top-left logo at 24,24 that is 120 by 60
            found = self.with_logo(p, self.logo(corner="top-left"))
            hit = rules(found, "theme-logo-overlap", severity="warning")
            self.assertTrue(hit)
            self.assertIn("top left", hit[0].detail)
            self.assertIn("24,24", hit[0].detail)

    def test_decorative_objects_in_the_corner_are_not_a_problem(self):
        with MutatedProject() as p:
            def everything_decorative(d):
                for o in d["baseLayer"]["objects"]:
                    o["accessibility"].update({"altText": "", "decorative": True})
            p.slide1(everything_decorative)
            found = self.with_logo(p, self.logo(corner="top-left"))
            on_slide_1 = [f for f in rules(found, "theme-logo-overlap") if f.file == "slides/slide-001.json"]
            self.assertEqual(on_slide_1, [], "a background shape under the logo is not hiding anything a learner needs")

    def test_a_free_corner_is_not_a_problem(self):
        with MutatedProject() as p:
            found = self.with_logo(p, self.logo(corner="bottom-right"))
            self.assertEqual(rules(found, "theme-logo-overlap"), [], "nothing is in the bottom right corner")

    def test_where_the_logo_sits_matches_the_shared_cases(self):
        rules_json = json.loads((validate.ROOT / "tools" / "theme-rules.json").read_text(encoding="utf-8"))
        self.assertGreater(len(rules_json["logoCases"]), 3)
        for c in rules_json["logoCases"]:
            self.assertEqual(list(validate.logo_box({"width": c["stage"][0], "height": c["stage"][1]}, c["logo"])), c["box"], c)

    def test_the_colour_pairs_are_the_shared_ones(self):
        rules_json = json.loads((validate.ROOT / "tools" / "theme-rules.json").read_text(encoding="utf-8"))
        self.assertEqual([list(p) for p in validate.THEME_PAIRS], rules_json["pairs"])


class ScenarioAndCast(unittest.TestCase):
    """A branching scenario, the project's cast of characters, and the input that lets a learner choose one."""

    CAST = [
        {"id": "maya", "name": "Maya Reyes", "role": "Nurse manager", "voice": "af_heart", "picture": None},
        {"id": "dev", "name": "Dev Patel", "role": "New hire", "voice": "am_adam", "picture": None},
    ]

    @staticmethod
    def narration(voice="af_heart", script="Hello."):
        return {"script": script, "voice": voice, "speed": 1.0, "lang": "en-US", "pronunciations": [], "audioCache": None}

    def line(self, lid, text="Something happens.", speaker=None, voice=None):
        return {"id": lid, "speaker": speaker, "text": text, "narration": self.narration(voice) if voice else None}

    def choice(self, cid, label, nxt, effects=(), response=()):
        return {"id": cid, "label": label, "next": nxt, "effects": list(effects), "response": list(response)}

    def node(self, nid, title, lines, choices=()):
        return {"id": nid, "title": title, "prompt": "What do you do?", "lines": lines, "choices": list(choices)}

    def scenario(self, **over):
        c = {
            "start": "n-start",
            "you": None,
            "nodes": [
                self.node("n-start", "At the desk", [self.line("l-1", "A patient arrives.", "maya")],
                          [self.choice("c-1", "Greet them", "n-mid", [{"variable": "var-trust", "add": 2}], [self.line("r-1", "She smiles.", "maya")]),
                           self.choice("c-2", "Ignore them", "n-end", [{"variable": "var-trust", "add": -2}])]),
                self.node("n-mid", "The questions", [self.line("l-2", "She asks about the wait.", "maya")],
                          [self.choice("c-3", "Explain the wait", "n-end", [{"variable": "var-trust", "add": 1}])]),
                self.node("n-end", "The end", [self.line("l-3", "The shift is over.")]),
            ],
            "meters": [{"id": "m-1", "label": "Trust", "variable": "var-trust", "min": -5, "max": 5}],
            "allowRetry": True,
            "finishedVariable": "var-done",
            "reflection": "What would you do differently?",
        }
        c.update(over)
        return c

    def install(self, p, content=None, cast="default", with_input=None):
        def project(d):
            d["variables"] += [{"id": "var-trust", "name": "trust", "type": "number", "initial": 0},
                               {"id": "var-done", "name": "done", "type": "boolean", "initial": False},
                               {"id": "var-who", "name": "who", "type": "string", "initial": ""}]
            if cast == "default":
                d["characters"] = copy.deepcopy(self.CAST)
            elif cast is not None:
                d["characters"] = cast
        p.edit("project.json", project)

        def slide(d):
            base = d["baseLayer"]["objects"]
            s = copy.deepcopy(base[0])
            s.update({"id": "obj-9400", "name": "Patient visit", "type": "scenario", "triggers": [], "content": content if content is not None else self.scenario()})
            s["accessibility"].update({"altText": "A scenario about greeting a patient", "role": "presentation", "tabOrder": 9})
            base.append(s)
            if with_input is not None:
                i = copy.deepcopy(base[0])
                i.update({"id": "obj-9401", "name": "Who are you", "type": "input", "triggers": [], "content": with_input})
                i["accessibility"].update({"altText": "Choose who you are", "role": "presentation", "tabOrder": 10})
                base.append(i)
        p.slide1(slide)

    def found(self, p):
        return [f for f in p.run() if f.rule.startswith(("scenario-", "character-", "input-"))
                or f.rule in ("voice-unknown", "condition-never-true", "duplicate-object-id", "asset-missing")]

    def hits(self, p, rule, severity=None):
        return rules(p.run(), rule, severity=severity)

    def test_a_complete_scenario_has_no_findings(self):
        with MutatedProject() as p:
            self.install(p)
            self.assertEqual(self.found(p), [])
            self.assertEqual([f for f in p.run() if f.severity == "error"], [])

    def test_the_start_has_to_be_a_situation(self):
        with MutatedProject() as p:
            self.install(p, self.scenario(start="n-nowhere"))
            self.assertEqual(len(self.hits(p, "scenario-start-missing", "error")), 1)

    def test_a_choice_has_to_lead_somewhere(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][0]["choices"][0]["next"] = "n-gone"
            self.install(p, c)
            hit = self.hits(p, "scenario-next-missing", "error")
            self.assertEqual(len(hit), 1)
            self.assertIn("Greet them", hit[0].detail)

    def test_ids_are_shared_across_the_whole_scenario(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][1]["lines"][0]["id"] = "l-1"          # same as a line in another situation
            c["nodes"][0]["choices"][1]["id"] = "n-end"       # same as a situation
            self.install(p, c)
            ids = sorted(f.detail.split("'")[1] for f in self.hits(p, "scenario-duplicate-id", "error"))
            self.assertEqual(ids, ["l-1", "n-end"])

    def test_a_situation_nothing_leads_to_is_a_warning(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"].append(self.node("n-lost", "Lost", [self.line("l-9", "Nobody comes here.")]))
            self.install(p, c)
            hit = self.hits(p, "scenario-unreachable", "warning")
            self.assertEqual(len(hit), 1)
            self.assertIn("Lost", hit[0].detail)

    def test_a_scenario_that_cannot_end_is_a_warning(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][1]["choices"][0]["next"] = "n-start"
            c["nodes"][0]["choices"][1]["next"] = "n-mid"
            self.install(p, c)
            self.assertEqual(len(self.hits(p, "scenario-no-ending", "warning")), 1)

    def test_a_line_needs_words(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][0]["lines"][0]["text"] = "   "
            self.install(p, c)
            hit = self.hits(p, "scenario-line-empty", "error")
            self.assertEqual(len(hit), 1)
            self.assertIn("At the desk", hit[0].detail)

    def test_a_response_with_no_words_is_found_too(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][0]["choices"][0]["response"][0]["text"] = ""
            self.install(p, c)
            hit = self.hits(p, "scenario-line-empty", "error")
            self.assertEqual(len(hit), 1)
            self.assertIn("response", hit[0].detail)

    def test_a_speaker_has_to_be_in_the_cast_or_be_you(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][0]["lines"][0]["speaker"] = "stranger"
            c["nodes"][1]["lines"][0]["speaker"] = "you"
            self.install(p, c)
            hit = self.hits(p, "scenario-speaker-unknown", "error")
            self.assertEqual(len(hit), 1)
            self.assertIn("stranger", hit[0].detail)

    def test_a_line_read_in_another_voice_than_its_speakers_is_a_warning(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][0]["lines"][0]["narration"] = self.narration("am_adam")     # Maya speaks, in Dev's voice
            c["nodes"][1]["lines"][0]["narration"] = self.narration("af_heart")    # Maya speaks, in her own voice
            c["nodes"][2]["lines"][0]["narration"] = self.narration("am_adam")     # the narrator may use any voice
            self.install(p, c)
            hit = self.hits(p, "scenario-voice-differs", "warning")
            self.assertEqual(len(hit), 1)
            self.assertIn("Maya Reyes", hit[0].detail)

    def test_a_voice_that_does_not_exist_on_a_line_is_an_error(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][2]["lines"][0]["narration"] = self.narration("zz_nobody")
            self.install(p, c)
            hit = self.hits(p, "voice-unknown", "error")
            self.assertEqual(len(hit), 1)
            self.assertIn("The shift is over", hit[0].detail)

    def test_a_choice_can_only_add_to_a_number_variable_that_exists(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][0]["choices"][0]["effects"] = [{"variable": "var-done", "add": 1}, {"variable": "var-nothing", "add": 1}]
            self.install(p, c)
            hit = self.hits(p, "scenario-effect-variable", "error")
            self.assertEqual(len(hit), 2)
            self.assertTrue(any("boolean" in f.detail for f in hit))
            self.assertTrue(any("not defined" in f.detail for f in hit))

    def test_two_choices_that_read_the_same_are_a_warning(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][0]["choices"][1]["label"] = "greet  them"
            self.install(p, c)
            self.assertEqual(len(self.hits(p, "scenario-choice-duplicate", "warning")), 1)

    def test_a_meter_shows_a_number_in_a_range(self):
        with MutatedProject() as p:
            c = self.scenario(meters=[{"id": "m-1", "label": "Done", "variable": "var-done", "min": 0, "max": 0}])
            self.install(p, c)
            self.assertEqual(len(self.hits(p, "scenario-meter-variable", "error")), 1)
            self.assertEqual(len(self.hits(p, "scenario-meter-range", "error")), 1)

    def test_the_variable_set_at_an_ending_is_true_or_false(self):
        with MutatedProject() as p:
            self.install(p, self.scenario(finishedVariable="var-trust"))
            self.assertEqual(len(self.hits(p, "scenario-finished-variable", "error")), 1)

    def test_the_learners_character_is_kept_in_a_text_variable(self):
        with MutatedProject() as p:
            self.install(p, self.scenario(you="var-trust"))
            self.assertEqual(len(self.hits(p, "scenario-you-variable", "error")), 1)

    def test_a_scenario_that_shows_who_you_are_but_nothing_lets_you_choose_is_a_warning(self):
        with MutatedProject() as p:
            self.install(p, self.scenario(you="var-who"))
            self.assertEqual(len(self.hits(p, "scenario-you-unset", "warning")), 1)

    def test_a_choice_of_character_satisfies_it(self):
        with MutatedProject() as p:
            who = {"kind": "character", "prompt": "Who are you?", "report": False, "variable": "var-who", "characters": ["maya", "dev"]}
            self.install(p, self.scenario(you="var-who"), with_input=who)
            self.assertEqual(self.found(p), [])

    def test_a_choice_of_character_must_name_people_in_the_cast(self):
        with MutatedProject() as p:
            who = {"kind": "character", "prompt": "Who are you?", "report": False, "variable": "var-who", "characters": ["maya", "stranger"]}
            self.install(p, self.scenario(), with_input=who)
            hit = self.hits(p, "input-character-unknown", "error")
            self.assertEqual(len(hit), 1)
            self.assertIn("stranger", hit[0].detail)

    def test_a_choice_of_character_saves_to_a_text_variable(self):
        with MutatedProject() as p:
            who = {"kind": "character", "prompt": "Who are you?", "report": False, "variable": "var-trust", "characters": ["maya", "dev"]}
            self.install(p, self.scenario(), with_input=who)
            self.assertEqual(len(self.hits(p, "input-variable-type", "error")), 1)

    def test_a_rule_can_branch_on_the_character_chosen(self):
        with MutatedProject() as p:
            who = {"kind": "character", "prompt": "Who are you?", "report": False, "variable": "var-who", "characters": ["maya", "dev"]}
            self.install(p, self.scenario(), with_input=who)

            def rule(d):
                d["baseLayer"]["objects"][0]["triggers"] = [{
                    "id": "trg-1", "event": "variableChange", "conditions": [{"variable": "var-who", "operator": "equals", "value": "dev"}],
                    "action": "setVariable", "target": "var-done"}]
            p.slide1(rule)
            self.assertEqual(self.hits(p, "condition-never-true"), [])

            def wrong(d):
                d["baseLayer"]["objects"][0]["triggers"][0]["conditions"][0]["value"] = "somebody-else"
            p.slide1(wrong)
            self.assertEqual(len(self.hits(p, "condition-never-true", "warning")), 1)

    # ---- the cast

    def cast_with(self, p, change):
        cast = copy.deepcopy(self.CAST)
        change(cast)
        self.install(p, cast=cast)

    def test_the_cast_is_optional(self):
        with MutatedProject() as p:
            self.assertEqual(self.found(p), [])

    def test_two_people_cannot_share_an_id(self):
        with MutatedProject() as p:
            self.cast_with(p, lambda c: c[1].update(id="maya"))
            self.assertEqual(len(self.hits(p, "character-duplicate-id", "error")), 1)

    def test_nobody_in_the_cast_is_called_you(self):
        with MutatedProject() as p:
            self.cast_with(p, lambda c: c[1].update(id="you"))
            self.assertEqual(len(self.hits(p, "character-id-reserved", "error")), 1)

    def test_a_person_needs_a_name_and_two_with_one_name_is_a_warning(self):
        with MutatedProject() as p:
            self.cast_with(p, lambda c: c[1].update(name=" "))
            self.assertEqual(len(self.hits(p, "character-name-empty", "error")), 1)
        with MutatedProject() as p:
            self.cast_with(p, lambda c: c[1].update(name="maya  reyes"))
            self.assertEqual(len(self.hits(p, "character-name-duplicate", "warning")), 2)

    def test_a_voice_has_to_exist(self):
        with MutatedProject() as p:
            self.cast_with(p, lambda c: c[1].update(voice="zz_nobody"))
            hit = self.hits(p, "voice-unknown", "error")
            self.assertEqual(len(hit), 1)
            self.assertIn("Dev Patel", hit[0].detail)

    def test_a_picture_is_described_or_marked_decorative(self):
        with MutatedProject() as p:
            self.cast_with(p, lambda c: c[0].update(picture={"src": "assets/images/maya.png", "alt": "", "decorative": False}))
            self.assertEqual(len(self.hits(p, "character-picture-alt", "error")), 1)
        with MutatedProject() as p:
            self.cast_with(p, lambda c: c[0].update(picture={"src": "assets/images/maya.png", "alt": "Maya in a blue coat", "decorative": True}))
            self.assertEqual(len(self.hits(p, "character-picture-alt", "error")), 1)

    def test_a_picture_has_to_be_in_the_project(self):
        with MutatedProject() as p:
            self.cast_with(p, lambda c: c[0].update(picture={"src": "assets/images/maya.png", "alt": "Maya in a blue coat", "decorative": False}))
            hit = self.hits(p, "asset-missing", "error")
            self.assertEqual(len(hit), 1)
            self.assertEqual(hit[0].file, "project.json")
        with MutatedProject() as p:
            (p.root / "assets" / "images").mkdir(parents=True, exist_ok=True)
            (p.root / "assets" / "images" / "maya.png").write_bytes(b"\x89PNG\r\n")
            self.cast_with(p, lambda c: c[0].update(picture={"src": "assets/images/maya.png", "alt": "Maya in a blue coat", "decorative": False}))
            self.assertEqual(self.hits(p, "asset-missing"), [])

    # ---- the shape

    def test_the_shape_is_checked_by_the_schema(self):
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][0]["choices"][0]["effects"] = [{"variable": "var-trust", "add": 0}]
            self.install(p, c)
            self.assertTrue([f for f in p.run() if f.severity == "error" and f.rule.startswith("schema")], "adding nothing is not an effect")
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][0]["choices"] = [self.choice(f"c-x{i}", f"Option {i}", "n-end") for i in range(7)]
            self.install(p, c)
            self.assertTrue([f for f in p.run() if f.severity == "error" and f.rule.startswith("schema")], "no more than six choices")
        with MutatedProject() as p:
            who = {"kind": "character", "prompt": "Who are you?", "report": False, "variable": "var-who", "characters": ["maya"]}
            self.install(p, self.scenario(), with_input=who)
            self.assertTrue([f for f in p.run() if f.severity == "error" and f.rule.startswith("schema")], "a choice needs at least two people")

    def test_the_lines_of_a_scenario_are_narrated_under_the_objects_id_and_the_lines(self):
        import narrate
        with MutatedProject() as p:
            c = self.scenario()
            c["nodes"][0]["lines"][0]["narration"] = self.narration("af_heart", "A patient arrives.")
            c["nodes"][0]["choices"][0]["response"][0]["narration"] = self.narration("af_heart", "She smiles.")
            self.install(p, c)
            keys = sorted(key for _, key, _ in narrate.narrated_objects(p.root) if key.startswith("obj-9400"))
            self.assertEqual(keys, ["obj-9400/l-1", "obj-9400/r-1"])


class IconsAndNavigation(unittest.TestCase):
    """An icon object, an icon on a button, and the rule actions that go to the next slide, the previous slide or the same slide again."""

    ARROW = [{"tag": "path", "d": "M5 12h14"}, {"tag": "path", "d": "m12 5 7 7-7 7"}]

    def icon(self, p, **over):
        def make(d):
            o = copy.deepcopy(d["baseLayer"]["objects"][0])
            o.update({"id": "obj-9500", "name": "Arrow", "type": "icon", "triggers": [], "narration": None})
            o["content"] = {"set": "lucide", "name": "arrow-right", "shapes": copy.deepcopy(self.ARROW)}
            o["style"] = {"color": "theme:color.accentStrong"}
            o["accessibility"].update({"altText": "Next", "role": "img", "tabOrder": 0, "decorative": False})
            for key, value in over.items():
                if key == "content":
                    o["content"].update(value)
                elif key == "style":
                    o["style"] = value
                elif key == "accessibility":
                    o["accessibility"].update(value)
            d["baseLayer"]["objects"].append(o)
        p.slide1(make)

    def found(self, p):
        return [f for f in p.run() if f.rule.startswith(("icon-", "trigger-next", "trigger-previous", "trigger-target")) or f.rule in ("schema", "alt-text-missing", "contrast")]

    def test_an_icon_with_alt_text_is_fine(self):
        with MutatedProject() as p:
            self.icon(p)
            self.assertEqual(self.found(p), [])
            self.assertEqual([f for f in p.run() if f.severity == "error"], [])

    def test_an_icon_needs_alt_text_or_to_be_decorative(self):
        with MutatedProject() as p:
            self.icon(p, accessibility={"altText": ""})
            self.assertTrue(rules(p.run(), "alt-text-missing", "obj-9500"))
        with MutatedProject() as p:
            self.icon(p, accessibility={"altText": "", "decorative": True})
            self.assertEqual(rules(p.run(), "alt-text-missing"), [])

    def test_an_icon_can_only_be_made_of_the_drawing_shapes(self):
        with MutatedProject() as p:
            self.icon(p, content={"shapes": [{"tag": "script", "d": "alert(1)"}]})
            self.assertTrue(rules(p.run(), "schema"))
        with MutatedProject() as p:
            self.icon(p, content={"shapes": [{"tag": "path", "d": "M0 0<script>"}]})
            self.assertTrue(rules(p.run(), "schema"), "a path can only hold path letters and numbers")
        with MutatedProject() as p:
            self.icon(p, content={"shapes": [{"tag": "path", "d": "M0 0", "onclick": "x"}]})
            self.assertTrue(rules(p.run(), "schema"), "no other attributes exist")
        with MutatedProject() as p:
            self.icon(p, content={"shapes": []})
            self.assertTrue(rules(p.run(), "schema"))

    def test_an_icon_that_is_hard_to_see_is_a_warning_unless_it_is_decoration(self):
        with MutatedProject() as p:
            self.icon(p, style={"color": "#f5f5f5"})
            hit = rules(p.run(), "icon-contrast", severity="warning")
            self.assertEqual(len(hit), 1)
            self.assertIn("1.4.11", hit[0].detail)
        with MutatedProject() as p:
            self.icon(p, style={"color": "#f5f5f5"}, accessibility={"altText": "", "decorative": True})
            self.assertEqual(rules(p.run(), "icon-contrast"), [])

    def test_icons_need_the_credits_page_on(self):
        with MutatedProject() as p:
            p.edit("project.json", lambda d: d.__setitem__("credits", False))
            self.icon(p)
            hit = rules(p.run(), "icon-credit-page-off", severity="warning")
            self.assertEqual(len(hit), 1)
            self.assertIn("Lucide", hit[0].detail)
        with MutatedProject() as p:
            self.icon(p)
            self.assertEqual(rules(p.run(), "icon-credit-page-off"), [])

    def test_a_button_can_show_an_icon_before_its_label_and_that_needs_the_credit_too(self):
        with MutatedProject() as p:
            p.edit("project.json", lambda d: d.__setitem__("credits", False))

            def button_with_icon(d):
                b = next(o for o in d["baseLayer"]["objects"] if o["type"] == "button")
                b["content"]["icon"] = {"set": "lucide", "name": "arrow-right", "shapes": copy.deepcopy(self.ARROW)}
            p.slide1(button_with_icon)
            self.assertEqual([f for f in p.run() if f.rule == "schema"], [])
            self.assertEqual(len(rules(p.run(), "icon-credit-page-off")), 1)

    def trigger(self, p, action, target="", slide="slides/slide-001.json", index=0):
        def make(d):
            o = d["baseLayer"]["objects"][index]
            o["triggers"] = [{"id": "trg-9", "event": "slideStart", "action": action, "target": target, "conditions": []}]
        p.edit(slide, make)

    def test_next_previous_and_replay_take_no_target(self):
        for action in ("nextSlide", "previousSlide", "replaySlide"):
            with MutatedProject() as p:
                self.trigger(p, action, "", "slides/slide-002.json" if action != "nextSlide" else "slides/slide-001.json")
                self.assertEqual([f for f in p.run() if f.rule in ("schema", "trigger-target-missing")], [], action)
            with MutatedProject() as p:
                self.trigger(p, action, "slide-002")
                self.assertTrue(rules(p.run(), "schema"), f"{action} with a target is not allowed")

    def test_an_action_that_needs_a_target_still_does(self):
        with MutatedProject() as p:
            self.trigger(p, "jumpToSlide", "")
            self.assertTrue(rules(p.run(), "schema"))

    def test_next_on_the_last_slide_and_back_on_the_first_go_nowhere(self):
        with MutatedProject() as p:
            self.trigger(p, "nextSlide", "", "slides/slide-002.json")
            hit = rules(p.run(), "trigger-next-last", severity="warning")
            self.assertEqual(len(hit), 1)
            self.assertEqual(hit[0].file, "slides/slide-002.json")
        with MutatedProject() as p:
            self.trigger(p, "previousSlide", "", "slides/slide-001.json")
            self.assertEqual(len(rules(p.run(), "trigger-previous-first", severity="warning")), 1)
        with MutatedProject() as p:
            self.trigger(p, "nextSlide", "", "slides/slide-001.json")
            self.trigger(p, "previousSlide", "", "slides/slide-002.json")
            self.assertEqual([f for f in p.run() if f.rule in ("trigger-next-last", "trigger-previous-first")], [], "both are fine in the middle of the course")


class TimingFromMedia(unittest.TestCase):
    """An object that appears and goes at moments in a video or an audio clip on its slide."""

    def media(self, d, kind="video", oid="obj-9600"):
        m = copy.deepcopy(d["baseLayer"]["objects"][0])
        m.update({"id": oid, "name": "Welcome clip", "type": kind, "triggers": [], "narration": None})
        m["content"] = {"src": f"assets/{kind}/welcome.{'mp4' if kind == 'video' else 'mp3'}", "captions": f"assets/captions/welcome.vtt", "transcript": "<p>Words.</p>"}
        m["accessibility"].update({"altText": "Welcome clip", "role": kind, "tabOrder": 9, "decorative": False})
        d["baseLayer"]["objects"].append(m)

    def follow(self, p, media_id="obj-9600", appear="media", start=5000, stay=None, kind="video", add_media=True, index=0, extra=None):
        def make(d):
            if add_media:
                self.media(d, kind)
            t = d["baseLayer"]["objects"][index]["timing"]
            t.update({"appear": appear, "start": start, "visibleFor": stay})
            if appear == "media":
                t["media"] = media_id
            if extra:
                d.update(extra)
        p.slide1(make)

    def found(self, p):
        return [f for f in p.run() if f.rule.startswith("timing-") or f.rule in ("schema", "needs-migration")]

    def test_an_object_following_a_video_on_its_slide_is_fine(self):
        with MutatedProject() as p:
            self.follow(p)
            self.assertEqual([f for f in self.found(p)], [])

    def test_an_object_can_follow_an_audio_clip_too(self):
        with MutatedProject() as p:
            self.follow(p, kind="audio", stay=4000)
            self.assertEqual(self.found(p), [])

    def test_it_must_say_which_one(self):
        with MutatedProject() as p:
            def no_media(d):
                self.media(d)
                d["baseLayer"]["objects"][0]["timing"] = {"appear": "media", "start": 1000, "visibleFor": None}
            p.slide1(no_media)
            self.assertTrue(rules(p.run(), "schema"), "media is required when appear is media")

    def test_another_kind_of_timing_cannot_name_one(self):
        with MutatedProject() as p:
            def stray(d):
                self.media(d)
                d["baseLayer"]["objects"][0]["timing"] = {"appear": "time", "start": 1000, "visibleFor": None, "media": "obj-9600"}
            p.slide1(stray)
            self.assertTrue(rules(p.run(), "schema"), "media is only for appear media")

    def test_what_it_follows_has_to_be_a_video_or_audio_on_the_same_slide(self):
        with MutatedProject() as p:
            self.follow(p, media_id="obj-nowhere")
            hit = rules(p.run(), "timing-media-missing", severity="error")
            self.assertEqual(len(hit), 1)
            self.assertIn("obj-nowhere", hit[0].detail)
        with MutatedProject() as p:
            # an object that is on the slide but is a picture, not a clip
            self.follow(p, media_id="obj-0002", add_media=False)
            self.assertEqual(len(rules(p.run(), "timing-media-missing", severity="error")), 1)

    def test_an_object_cannot_follow_itself(self):
        with MutatedProject() as p:
            def me(d):
                o = d["baseLayer"]["objects"][0]
                o["timing"] = {"appear": "media", "start": 0, "visibleFor": None, "media": o["id"]}
            p.slide1(me)
            self.assertEqual(len(rules(p.run(), "timing-media-self", severity="error")), 1)

    def test_a_slide_that_moves_on_by_itself_is_a_warning_when_something_follows_a_clip(self):
        with MutatedProject() as p:
            self.follow(p, extra={"duration": 20000})
            hit = rules(p.run(), "timing-media-advance", severity="warning")
            self.assertEqual(len(hit), 1)
        with MutatedProject() as p:
            self.follow(p)
            self.assertEqual(rules(p.run(), "timing-media-advance"), [])

    def test_the_other_timing_warnings_still_apply_to_a_clips_time(self):
        with MutatedProject() as p:
            self.follow(p, stay=1000)
            self.assertTrue(rules(p.run(), "timing-too-brief", severity="warning"), "text that is up for one second of the clip is still too brief")

    def test_a_time_after_the_slide_moves_on_does_not_count_for_a_clip(self):
        with MutatedProject() as p:
            self.follow(p, start=50000, extra={"duration": 20000})
            self.assertEqual(rules(p.run(), "timing-after-advance"), [], "the clock is not the clip")


class Looks(unittest.TestCase):
    """The looks (states) of an object: what a look may be called, a rule that applies one, what a screen reader is told, and how
    readable each look is on its own and stacked with the others."""

    BUTTON = 3  # obj-0004: white on blue, with a hover look and a visited look

    def rule(self, value="done", event="slideStart", target="obj-0004", tid="trg-9001", **extra):
        t = {"id": tid, "event": event, "action": "changeState", "target": target, "conditions": []}
        if value is not None:
            t["value"] = value
        t.update(extra)
        return t

    def give(self, p, states=None, rule=None, index=None, accessibility=None):
        """Give the button looks, and optionally a rule that applies one."""
        def make(o):
            if states is not None:
                o["states"] = states
            if rule is not None:
                o["triggers"].append(rule)
            if accessibility:
                o["accessibility"].update(accessibility)
        p.obj(self.BUTTON if index is None else index, make)

    DONE = {"done": {"style": {"fill": "#5b21b6"}, "announce": "Marked as done"}}

    def test_a_look_a_rule_applies_and_says_something_is_fine(self):
        with MutatedProject() as p:
            self.give(p, states=self.DONE, rule=self.rule())
            self.assertEqual([f for f in p.run() if f.severity == "error"], [])
            self.assertEqual(rules(p.run(), "state-silent"), [])

    def test_a_look_applied_by_a_rule_with_no_message_is_a_warning(self):
        with MutatedProject() as p:
            self.give(p, states={"done": {"style": {"fill": "#5b21b6"}}}, rule=self.rule())
            hit = rules(p.run(), "state-silent", severity="warning")
            self.assertEqual(len(hit), 1)
            self.assertIn("'done'", hit[0].detail)
            self.assertIn("screen reader", hit[0].message.lower())

    def test_a_pair_of_click_and_key_triggers_is_reported_once(self):
        with MutatedProject() as p:
            both = [self.rule(event="click", tid="trg-9001"), self.rule(event="keyActivate", tid="trg-9002")]
            def make(o):
                o["states"] = {"done": {"style": {"fill": "#5b21b6"}}}
                o["triggers"].extend(both)
            p.obj(self.BUTTON, make)
            self.assertEqual(len(rules(p.run(), "state-silent")), 1)

    def test_going_back_to_normal_and_disabling_need_no_message(self):
        with MutatedProject() as p:
            self.give(p, states={"disabled": {"style": {"opacity": 0.4}}}, rule=self.rule(value="disabled"))
            self.assertEqual(rules(p.run(), "state-silent"), [], "a disabled control already says so to assistive technology")
        with MutatedProject() as p:
            self.give(p, rule=self.rule(value="normal"))
            self.assertEqual(rules(p.run(), "state-silent"), [])
            self.assertEqual(rules(p.run(), "trigger-state-missing"), [])
        with MutatedProject() as p:
            self.give(p, rule=self.rule(value=None))
            self.assertEqual(rules(p.run(), "trigger-state-missing"), [], "no value means normal")

    def test_a_decorative_object_needs_no_message(self):
        with MutatedProject() as p:
            self.give(p, states={"done": {"style": {"fill": "#5b21b6"}}}, rule=self.rule(), accessibility={"decorative": True, "altText": ""})
            self.assertEqual(rules(p.run(), "state-silent"), [], "a screen reader does not reach a decorative object")

    def test_a_message_on_ready_made_looks_is_not_needed_for_them_to_apply_on_their_own(self):
        with MutatedProject() as p:
            self.assertEqual(rules(p.run(), "state-silent"), [], "hover and visited are applied by the course, never by a rule here")

    def test_a_rule_cannot_apply_a_look_the_object_does_not_have(self):
        with MutatedProject() as p:
            self.give(p, rule=self.rule(value="nope"))
            hit = rules(p.run(), "trigger-state-missing", severity="error")
            self.assertEqual(len(hit), 1)
            self.assertIn("'nope'", hit[0].detail)

    def test_a_rule_can_apply_a_look_on_another_object_of_the_slide(self):
        with MutatedProject() as p:
            p.obj(3, lambda o: o["states"].update(self.DONE))
            p.obj(0, lambda o: o["triggers"].append(self.rule(target="obj-0004")))
            self.assertEqual(rules(p.run(), "trigger-state-missing"), [])
        with MutatedProject() as p:
            p.obj(0, lambda o: o["triggers"].append(self.rule(target="obj-0004", value="done")))
            self.assertTrue(rules(p.run(), "trigger-state-missing"), "the look has to be on the object it is applied to, not the one with the rule")

    def test_a_looks_name_is_text(self):
        with MutatedProject() as p:
            self.give(p, rule=self.rule(value=5))
            self.assertTrue(rules(p.run(), "trigger-value-type", severity="error"))

    def test_a_rule_pointing_at_nothing_is_the_old_error(self):
        with MutatedProject() as p:
            self.give(p, rule=self.rule(target="obj-nowhere"))
            self.assertTrue(rules(p.run(), "trigger-target-missing"))
            self.assertEqual(rules(p.run(), "trigger-state-missing"), [], "one problem, said once")

    def test_normal_cannot_be_a_look(self):
        with MutatedProject() as p:
            self.give(p, states={"normal": {"style": {"fill": "#000000"}}})
            self.assertTrue(rules(p.run(), "state-name-normal", severity="error"))

    def test_a_looks_name_has_limits(self):
        for bad in ["", " leading", "trailing ", "x" * 41]:
            with MutatedProject() as p:
                self.give(p, states={bad: {"style": {"fill": "#5b21b6"}}})
                self.assertTrue(rules(p.run(), "schema"), repr(bad))
        for good in ["x", "Correct answer", "x" * 40, "ñandú"]:
            with MutatedProject() as p:
                self.give(p, states={good: {"style": {"fill": "#5b21b6"}}})
                self.assertEqual(rules(p.run(), "schema"), [], repr(good))

    def test_the_spoken_message_has_limits(self):
        for bad in ["", "x" * 201, 5]:
            with MutatedProject() as p:
                self.give(p, states={"done": {"style": {"fill": "#5b21b6"}, "announce": bad}})
                self.assertTrue(rules(p.run(), "schema"), repr(bad))
        with MutatedProject() as p:
            self.give(p, states={"done": {"announce": "x" * 200}})
            self.assertEqual(rules(p.run(), "schema"), [], "a look can be nothing but a message")

    def test_a_look_cannot_be_empty(self):
        with MutatedProject() as p:
            self.give(p, states={"done": {}})
            self.assertTrue(rules(p.run(), "schema"))

    # ---- readability

    def test_a_look_that_fades_the_text_is_checked_as_it_looks(self):
        with MutatedProject() as p:
            self.give(p, states={"hover": {"style": {"fill": "#0a4fd1"}}, "visited": {"style": {"opacity": 0.85}}})
            hit = rules(p.run(), "contrast", "obj-0004", "error")
            self.assertEqual(len(hit), 1)
            self.assertIn("85% solid", hit[0].detail)
            self.assertIn("'visited'", hit[0].detail)

    def test_a_barely_faded_look_that_still_reads_is_fine(self):
        with MutatedProject() as p:
            self.give(p, states={"visited": {"style": {"opacity": 0.97}}})
            self.assertEqual(rules(p.run(), "contrast"), [])

    def test_a_disabled_look_may_fade(self):
        with MutatedProject() as p:
            self.give(p, states={"disabled": {"style": {"opacity": 0.4}}})
            self.assertEqual(rules(p.run(), "contrast"), [], "WCAG does not ask a control that cannot be used for contrast")

    def test_an_object_that_is_faded_all_the_time_is_checked_too(self):
        with MutatedProject() as p:
            p.obj(1, lambda o: o["style"].__setitem__("opacity", 0.5))
            hit = rules(p.run(), "contrast", "obj-0002", "error")
            self.assertEqual(len(hit), 1)
            self.assertIn("50% solid", hit[0].detail)

    def test_nothing_is_wrong_with_full_solidness(self):
        with MutatedProject() as p:
            p.obj(0, lambda o: o["style"].__setitem__("opacity", 1))
            self.assertEqual(rules(p.run(), "contrast"), [])

    def test_looks_that_pass_alone_but_not_together_are_caught(self):
        hover = {"hover": {"style": {"color": "#f2f6ff"}}}
        visited = {"visited": {"style": {"fill": "#1a68ff"}}}
        for states in (hover, visited):
            with MutatedProject() as p:
                self.give(p, states=states)
                self.assertEqual(rules(p.run(), "contrast"), [], "each is fine alone")
        with MutatedProject() as p:
            self.give(p, states={**hover, **visited})
            hit = rules(p.run(), "contrast", "obj-0004", "error")
            self.assertEqual(len(hit), 1)
            self.assertIn("'visited' and 'hover' together", hit[0].detail)

    def test_the_look_a_rule_applies_stacks_under_hover(self):
        with MutatedProject() as p:
            self.give(p, states={"hover": {"style": {"color": "#f2f6ff"}}, "done": {"style": {"fill": "#1a68ff"}, "announce": "Done"}})
            hit = rules(p.run(), "contrast", "obj-0004", "error")
            self.assertEqual(len(hit), 1)
            self.assertIn("'done' and 'hover' together", hit[0].detail)

    def test_how_looks_stack(self):
        states = {"visited": {"style": {"color": "#111111", "fill": "#222222"}}, "hover": {"style": {"fill": "#333333"}},
                  "done": {"style": {"fill": "#444444"}}, "shut": {"announce": "Shut"}}
        got = {tuple(names): over for _, names, over in validate._look_stacks(states)}
        self.assertEqual(got[("visited",)], {"color": "#111111", "fill": "#222222"})
        self.assertEqual(got[("hover",)], {"fill": "#333333"})
        self.assertEqual(got[("done",)], {"fill": "#444444"})
        self.assertEqual(got[("visited", "hover")], {"color": "#111111", "fill": "#333333"}, "hover wins over visited")
        self.assertEqual(got[("visited", "done")], {"color": "#111111", "fill": "#444444"}, "a look a rule applied wins over visited")
        self.assertNotIn(("done", "hover"), got, "hover wins over done, so this looks like hover alone and is checked once")
        self.assertNotIn(("visited", "done", "hover"), got, "and this looks like visited with hover")
        self.assertNotIn(("shut",), got, "a look with no style changes nothing, so it adds nothing to check")
        self.assertEqual(validate._look_stacks({}), [])

    def test_an_icon_look_is_checked_for_visibility(self):
        arrow = [{"tag": "path", "d": "M5 12h14"}, {"tag": "path", "d": "m12 5 7 7-7 7"}]
        def make(d):
            o = copy.deepcopy(d["baseLayer"]["objects"][0])
            o.update({"id": "obj-9500", "name": "Arrow", "type": "icon", "triggers": [], "narration": None})
            o["content"] = {"set": "lucide", "name": "arrow-right", "shapes": arrow}
            o["style"] = {"color": "theme:color.accentStrong"}
            o["states"] = {"hover": {"style": {"color": "#dddddd"}}}
            o["accessibility"].update({"altText": "Next", "role": "img", "tabOrder": 0, "decorative": False})
            d["baseLayer"]["objects"].append(o)
        with MutatedProject() as p:
            p.slide1(make)
            hit = rules(p.run(), "icon-contrast", "obj-9500", "warning")
            self.assertEqual(len(hit), 1)
            self.assertIn("'hover'", hit[0].detail)
        with MutatedProject() as p:
            def faded(d):
                make(d)
                d["baseLayer"]["objects"][-1]["states"] = {"visited": {"style": {"opacity": 0.3}}}
            p.slide1(faded)
            self.assertIn("30% solid", rules(p.run(), "icon-contrast", "obj-9500")[0].detail)


class DeckImportRules(unittest.TestCase):
    """Slides and shapes imported from a PowerPoint deck say where they came from, and the project lists its decks."""

    DECK = {"id": "deck-7b21", "name": "Intro.pptx", "importedAt": "2026-10-10T14:22:00Z", "slideWidth": 12192000, "slideHeight": 6858000,
            "pixelsPerInch": 96, "offsetX": 0, "offsetY": 0}

    def slide_prov(self, **over):
        prov = {"sourceDeck": "deck-7b21", "slideId": "256", "slideIndex": 0, "importedAt": "2026-10-10T14:22:00Z",
                "base": {"name": "Welcome", "background": None}}
        prov.update(over)
        return prov

    def base(self, **over):
        b = {"type": "text", "name": "Title", "geometry": {"x": 80, "y": 48, "width": 1120, "height": 80, "rotation": 0},
             "content": {"html": "<h1>Welcome</h1>"}, "style": {"fontSize": 44}, "altText": "Welcome", "decorative": False}
        b.update(over)
        return b

    def found(self, p):
        return [f for f in p.run() if f.rule in ("schema", "import-source-missing", "provenance-duplicate", "needs-migration")]

    def test_a_slide_and_a_shape_from_a_listed_deck_are_fine(self):
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("provenance", self.slide_prov()))
            p.obj(0, lambda o: o.__setitem__("provenance", {"sourceDeck": "deck-7b21", "slideIndex": 0, "shapeId": "256/2", "slideId": "256",
                                                           "importedAt": "2026-10-10T14:22:00Z", "sourceHash": "a1b2c3d4e5f6", "base": self.base()}))
            self.assertEqual(self.found(p), [])

    def test_a_slide_must_say_which_slide_of_the_deck(self):
        with MutatedProject() as p:
            def no_id(d):
                prov = self.slide_prov()
                del prov["slideId"]
                d["provenance"] = prov
            p.slide1(no_id)
            self.assertTrue(rules(p.run(), "schema"))

    def test_the_snapshot_of_a_shape_is_checked(self):
        for bad in ({"altText": 5}, {"decorative": "no"}, {"geometry": {"x": 1}}, {"extra": 1}):
            with MutatedProject() as p:
                p.obj(0, lambda o: o.__setitem__("provenance", {"sourceDeck": "deck-7b21", "slideIndex": 0, "shapeId": "256/2", "importedAt": "2026-10-10T14:22:00Z", "base": self.base(**bad)}))
                self.assertTrue(rules(p.run(), "schema"), repr(bad))

    def test_two_slides_cannot_both_be_the_same_slide_of_a_deck(self):
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("provenance", self.slide_prov()))
            p.edit("slides/slide-002.json", lambda d: d.__setitem__("provenance", self.slide_prov()))
            hit = rules(p.run(), "provenance-duplicate", severity="warning")
            self.assertEqual({f.object_id for f in hit if "slide 256" in f.detail}, {"slide-001", "slide-002"})

    def test_a_deck_the_project_does_not_list_is_named_once(self):
        with MutatedProject() as p:
            p.edit("project.json", lambda d: d.__setitem__("sources", []))
            p.slide1(lambda d: d.__setitem__("provenance", self.slide_prov()))
            hit = rules(p.run(), "import-source-missing", severity="warning")
            self.assertEqual(len(hit), 1, "slides and shapes of one deck are one finding")
            self.assertEqual(hit[0].file, "project.json")
            self.assertIn("deck-7b21", hit[0].detail)

    def test_a_listed_deck_that_nothing_uses_is_fine(self):
        with MutatedProject() as p:
            p.edit("project.json", lambda d: d["sources"].append({**self.DECK, "id": "deck-0000"}))
            self.assertEqual(self.found(p), [])

    def test_a_listed_deck_is_checked(self):
        for bad in ({"id": "7b21"}, {"id": "deck-"}, {"slideWidth": 0}, {"pixelsPerInch": 0}, {"extra": 1}):
            with MutatedProject() as p:
                p.edit("project.json", lambda d: d.__setitem__("sources", [{**self.DECK, **bad}]))
                self.assertTrue(rules(p.run(), "schema"), repr(bad))
        for good in ({"syncedAt": "2026-10-12T09:00:00Z"}, {"pixelsPerInch": 72.5, "offsetX": -12.5, "offsetY": 40}):
            with MutatedProject() as p:
                p.edit("project.json", lambda d: d.__setitem__("sources", [{**self.DECK, **good}]))
                self.assertEqual(rules(p.run(), "schema"), [], repr(good))

    def test_a_capture_slide_is_still_a_capture_slide(self):
        with MutatedProject() as p:
            p.slide1(lambda d: d.__setitem__("provenance", {"sourceCapture": "capture-2026-10-13", "stepId": "step-1"}))
            self.assertEqual(self.found(p), [])


if __name__ == "__main__":
    unittest.main(verbosity=1)
