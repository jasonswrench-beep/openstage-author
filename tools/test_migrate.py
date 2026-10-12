"""Tests for updating a 0.1.0 project to the current format. Run with:  python tools/test_migrate.py"""
import json
import pathlib
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import migrate  # noqa: E402
import validate  # noqa: E402

FIXTURE = pathlib.Path(__file__).resolve().parent / "fixtures" / "v0.1.0.osproj"


class Migration(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.dir = self.tmp / "p.osproj"
        shutil.copytree(FIXTURE, self.dir)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def load(self, rel):
        return json.loads((self.dir / rel).read_text(encoding="utf-8"))

    def test_an_old_project_is_refused_by_the_validator_until_it_is_updated(self):
        rules = [f.rule for f in validate.validate_project(self.dir)]
        self.assertEqual(rules, ["needs-migration"])

    def test_the_update_gives_the_project_a_theme_and_slides_a_layout_and_background(self):
        report = migrate.migrate(self.dir)
        self.assertEqual((report["status"], report["from"], report["to"]), ("updated", "0.1.0", "0.14.0"))
        project = self.load("project.json")
        self.assertEqual(project["schemaVersion"], "0.14.0")
        self.assertEqual(project["theme"], {"ref": "theme.json"})
        self.assertEqual(self.load("theme.json")["id"], "classic")
        for name in ("slide-001", "slide-002"):
            slide = self.load(f"slides/{name}.json")
            self.assertIsNone(slide["layout"])
            self.assertIsNone(slide["background"])
            self.assertEqual(list(slide)[:5], ["id", "name", "duration", "layout", "background"], "new fields sit after duration")

    def test_nothing_else_about_a_slide_changes(self):
        before = self.load("slides/slide-002.json")
        migrate.migrate(self.dir)
        after = self.load("slides/slide-002.json")
        after.pop("layout")
        after.pop("background")
        for layer in [after["baseLayer"], *after["layers"]]:
            for obj in layer["objects"]:
                self.assertEqual(obj.pop("timing"), {"appear": "time", "start": 0, "visibleFor": None}, "every object starts always there")
                self.assertEqual(obj.pop("animation"), {"enter": {"effect": "none", "duration": 500}, "exit": {"effect": "none", "duration": 500}}, "and with no effect")
        self.assertEqual(after, before)

    def test_the_updated_project_passes_the_validator(self):
        migrate.migrate(self.dir)
        errors = [f for f in validate.validate_project(self.dir) if f.severity == "error"]
        self.assertEqual(errors, [])

    def test_the_old_files_are_kept_exactly(self):
        originals = {rel: (self.dir / rel).read_bytes() for rel in ("project.json", "slides/slide-001.json", "slides/slide-002.json")}
        report = migrate.migrate(self.dir)
        self.assertEqual(report["backup"], ".openstage-backup/0.1.0")
        for rel, data in originals.items():
            self.assertEqual((self.dir / report["backup"] / rel).read_bytes(), data, f"{rel} is backed up byte for byte")

    def test_updating_twice_changes_nothing_the_second_time(self):
        migrate.migrate(self.dir)
        snapshot = {p.name: p.read_bytes() for p in self.dir.rglob("*.json") if ".openstage-backup" not in p.parts}
        report = migrate.migrate(self.dir)
        self.assertEqual(report["status"], "current")
        self.assertEqual({p.name: p.read_bytes() for p in self.dir.rglob("*.json") if ".openstage-backup" not in p.parts}, snapshot)
        self.assertFalse((self.dir / ".openstage-backup" / "0.1.0-2").exists(), "no second backup is made")

    def test_a_project_from_a_newer_version_is_refused_and_left_alone(self):
        project = self.load("project.json")
        project["schemaVersion"] = "9.0.0"
        (self.dir / "project.json").write_text(json.dumps(project), encoding="utf-8")
        before = (self.dir / "project.json").read_bytes()
        with self.assertRaises(ValueError):
            migrate.migrate(self.dir)
        self.assertEqual((self.dir / "project.json").read_bytes(), before)
        self.assertFalse((self.dir / ".openstage-backup").exists())

    def test_an_unknown_old_version_is_refused(self):
        project = self.load("project.json")
        project["schemaVersion"] = "0.0.1"
        (self.dir / "project.json").write_text(json.dumps(project), encoding="utf-8")
        with self.assertRaises(ValueError):
            migrate.migrate(self.dir)

    def test_a_second_update_after_restoring_keeps_both_backups(self):
        migrate.migrate(self.dir)
        shutil.copy2(self.dir / ".openstage-backup" / "0.1.0" / "project.json", self.dir / "project.json")
        for name in ("slide-001", "slide-002"):
            shutil.copy2(self.dir / ".openstage-backup" / "0.1.0" / "slides" / f"{name}.json", self.dir / "slides" / f"{name}.json")
        report = migrate.migrate(self.dir)
        self.assertEqual(report["backup"], ".openstage-backup/0.1.0-2")
        self.assertTrue((self.dir / ".openstage-backup" / "0.1.0").exists())

    def test_the_command_line_reports_what_it_did(self):
        self.assertEqual(migrate.main([str(self.dir)]), 0)
        self.assertEqual(migrate.main([str(self.dir)]), 0)
        self.assertEqual(migrate.main([str(self.dir / "missing")]), 1)


EXAMPLES = pathlib.Path(__file__).resolve().parent.parent / "examples"


class CompletionSetting(unittest.TestCase):
    """0.8.0 to 0.9.0: the author chooses what completes a course. Old courses keep the rule they had."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.dir = self.tmp / "p.osproj"
        shutil.copytree(EXAMPLES / "minimal.osproj", self.dir, ignore=shutil.ignore_patterns(".cache"))
        path = self.dir / "project.json"
        project = json.loads(path.read_text(encoding="utf-8"))
        project["schemaVersion"] = "0.8.0"
        del project["completion"]
        path.write_text(json.dumps(project, indent=2), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_a_0_8_0_course_keeps_counting_every_slide(self):
        self.assertEqual([f.rule for f in validate.validate_project(self.dir)], ["needs-migration"])
        report = migrate.migrate(self.dir)
        self.assertEqual((report["status"], report["from"], report["to"]), ("updated", "0.8.0", "0.14.0"))
        project = json.loads((self.dir / "project.json").read_text(encoding="utf-8"))
        self.assertEqual(project["schemaVersion"], "0.14.0")
        self.assertEqual(project["completion"], {"slides": "all"})
        keys = list(project)
        self.assertEqual(keys[keys.index("credits") + 1], "completion", "the new setting sits beside the credits switch")
        self.assertTrue(any("every slide" in n for n in report["notes"]))

    def test_the_updated_course_validates_and_the_old_files_are_kept(self):
        before = (self.dir / "project.json").read_bytes()
        report = migrate.migrate(self.dir)
        self.assertEqual([f for f in validate.validate_project(self.dir) if f.severity == "error"], [])
        self.assertEqual((self.dir / report["backup"] / "project.json").read_bytes(), before)

    def test_a_course_already_at_0_9_0_is_left_alone(self):
        migrate.migrate(self.dir)
        again = migrate.migrate(self.dir)
        self.assertEqual((again["status"], again["changed"]), ("current", []))


class ResultsAndCertificates(unittest.TestCase):
    """0.9.0 to 0.10.0: results boxes and certificates. Nothing in an existing project changes."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.dir = self.tmp / "p.osproj"
        shutil.copytree(EXAMPLES / "minimal.osproj", self.dir, ignore=shutil.ignore_patterns(".cache"))
        path = self.dir / "project.json"
        project = json.loads(path.read_text(encoding="utf-8"))
        project["schemaVersion"] = "0.9.0"
        path.write_text(json.dumps(project, indent=2), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_a_0_9_0_course_is_updated_and_nothing_else_changes(self):
        before = json.loads((self.dir / "project.json").read_text(encoding="utf-8"))
        slide_before = (self.dir / "slides" / "slide-001.json").read_text(encoding="utf-8")
        self.assertEqual([f.rule for f in validate.validate_project(self.dir)], ["needs-migration"])
        report = migrate.migrate(self.dir)
        self.assertEqual((report["status"], report["from"], report["to"]), ("updated", "0.9.0", "0.14.0"))
        after = json.loads((self.dir / "project.json").read_text(encoding="utf-8"))
        self.assertEqual(after.pop("schemaVersion"), "0.14.0")
        before.pop("schemaVersion")
        self.assertEqual(after, before, "only the version changes")
        self.assertEqual(json.loads((self.dir / "slides" / "slide-001.json").read_text(encoding="utf-8")),
                         json.loads(slide_before), "slides are unchanged")
        self.assertTrue(any("results box" in n and "certificate" in n for n in report["notes"]))
        self.assertEqual([f for f in validate.validate_project(self.dir) if f.severity == "error"], [])


class ItemNarration(unittest.TestCase):
    """0.10.0 to 0.11.0: every item of an interaction can have its own narration. Existing items start with none."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.dir = self.tmp / "p.osproj"
        shutil.copytree(EXAMPLES / "interactions.osproj", self.dir, ignore=shutil.ignore_patterns(".cache"))
        # Make it a 0.10.0 project: the version before items had a narration field at all.
        self.before = {}
        for path in sorted((self.dir / "slides").glob("*.json")):
            slide = json.loads(path.read_text(encoding="utf-8"))
            for layer in [slide["baseLayer"], *slide["layers"]]:
                for obj in layer["objects"]:
                    if obj["type"] == "interaction":
                        for item in obj["content"]["items"]:
                            del item["narration"]
            self.before[path.name] = slide
            path.write_text(json.dumps(slide, indent=2), encoding="utf-8")
        pj = self.dir / "project.json"
        project = json.loads(pj.read_text(encoding="utf-8"))
        project["schemaVersion"] = "0.10.0"
        pj.write_text(json.dumps(project, indent=2), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def items(self, slide):
        return [item for layer in [slide["baseLayer"], *slide["layers"]] for obj in layer["objects"]
                if obj["type"] == "interaction" for item in obj["content"]["items"]]

    def test_a_0_10_0_course_is_refused_until_updated_then_every_item_has_a_null_narration(self):
        self.assertEqual([f.rule for f in validate.validate_project(self.dir)], ["needs-migration"])
        report = migrate.migrate(self.dir)
        self.assertEqual((report["status"], report["from"], report["to"]), ("updated", "0.10.0", "0.14.0"))
        count = 0
        for name, was in self.before.items():
            now = json.loads((self.dir / "slides" / name).read_text(encoding="utf-8"))
            for item in self.items(now):
                count += 1
                self.assertIsNone(item["narration"])
                keys = list(item)
                self.assertEqual(keys[keys.index("image") + 1], "narration", "the new field sits after the image")
                item.pop("narration")
            self.assertEqual(now, was, "nothing else on the slide changes")
        self.assertGreater(count, 20, "the example has plenty of interaction items to check")
        self.assertTrue(any("item" in n and "narration" in n for n in report["notes"]))
        self.assertEqual([f for f in validate.validate_project(self.dir) if f.severity == "error"], [])

    def test_the_old_slides_are_kept_exactly(self):
        originals = {p.name: p.read_bytes() for p in (self.dir / "slides").glob("*.json")}
        report = migrate.migrate(self.dir)
        for name, data in originals.items():
            self.assertEqual((self.dir / report["backup"] / "slides" / name).read_bytes(), data)


class FilesToDownload(unittest.TestCase):
    """0.11.0 to 0.12.0: files to download. Nothing in an existing project changes but the version."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.dir = self.tmp / "p.osproj"
        shutil.copytree(EXAMPLES / "interactions.osproj", self.dir, ignore=shutil.ignore_patterns(".cache"))
        path = self.dir / "project.json"
        project = json.loads(path.read_text(encoding="utf-8"))
        project["schemaVersion"] = "0.11.0"
        path.write_text(json.dumps(project, indent=2), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_a_0_11_0_course_is_updated_and_nothing_else_changes(self):
        before = json.loads((self.dir / "project.json").read_text(encoding="utf-8"))
        slides_before = {p.name: p.read_bytes() for p in (self.dir / "slides").glob("*.json")}
        self.assertEqual([f.rule for f in validate.validate_project(self.dir)], ["needs-migration"])
        report = migrate.migrate(self.dir)
        self.assertEqual((report["status"], report["from"], report["to"]), ("updated", "0.11.0", "0.14.0"))
        after = json.loads((self.dir / "project.json").read_text(encoding="utf-8"))
        self.assertEqual(after.pop("schemaVersion"), "0.14.0")
        before.pop("schemaVersion")
        self.assertEqual(after, before, "only the version changes")
        for name, data in slides_before.items():
            self.assertEqual(json.loads((self.dir / "slides" / name).read_text(encoding="utf-8")), json.loads(data), "slides are unchanged")
        self.assertTrue(any("download" in n for n in report["notes"]))
        self.assertEqual([f for f in validate.validate_project(self.dir) if f.severity == "error"], [])


class ObjectTiming(unittest.TestCase):
    """0.12.0 to 0.13.0: every object gets a timing, and the starting one means "always there"."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.dir = self.tmp / "p.osproj"
        shutil.copytree(EXAMPLES / "lms-test-lesson.osproj", self.dir, ignore=shutil.ignore_patterns(".cache"))
        # Make it a 0.12.0 project: the version before objects had a timing at all.
        self.before = {}
        for path in sorted((self.dir / "slides").glob("*.json")):
            slide = json.loads(path.read_text(encoding="utf-8"))
            for layer in [slide["baseLayer"], *slide["layers"]]:
                for obj in layer["objects"]:
                    del obj["timing"]
            self.before[path.name] = slide
            path.write_text(json.dumps(slide, indent=2), encoding="utf-8")
        pj = self.dir / "project.json"
        project = json.loads(pj.read_text(encoding="utf-8"))
        project["schemaVersion"] = "0.12.0"
        pj.write_text(json.dumps(project, indent=2), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_every_object_gets_the_starting_timing_after_its_triggers_and_nothing_else_changes(self):
        self.assertEqual([f.rule for f in validate.validate_project(self.dir)], ["needs-migration"])
        report = migrate.migrate(self.dir)
        self.assertEqual((report["status"], report["from"], report["to"]), ("updated", "0.12.0", "0.14.0"))
        objects = 0
        for name, was in self.before.items():
            now = json.loads((self.dir / "slides" / name).read_text(encoding="utf-8"))
            for layer in [now["baseLayer"], *now["layers"]]:
                for obj in layer["objects"]:
                    objects += 1
                    self.assertEqual(obj["timing"], {"appear": "time", "start": 0, "visibleFor": None})
                    keys = list(obj)
                    self.assertEqual(keys[keys.index("triggers") + 1], "timing", "the new field sits after the triggers")
                    del obj["timing"]
            self.assertEqual(now, was, "nothing else on the slide changes")
        self.assertGreater(objects, 60, "the lesson has plenty of objects to check")
        self.assertTrue(any("appear" in n and "disappear" in n for n in report["notes"]))
        self.assertEqual([f for f in validate.validate_project(self.dir) if f.severity == "error"], [])

    def test_a_timing_the_author_already_set_is_kept(self):
        path = self.dir / "slides" / "slide-001.json"
        slide = json.loads(path.read_text(encoding="utf-8"))
        slide["baseLayer"]["objects"][0]["timing"] = {"appear": "time", "start": 2500, "visibleFor": None}
        path.write_text(json.dumps(slide, indent=2), encoding="utf-8")
        migrate.migrate(self.dir)
        again = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(again["baseLayer"]["objects"][0]["timing"]["start"], 2500)

    def test_the_old_slides_are_kept_exactly(self):
        originals = {p.name: p.read_bytes() for p in (self.dir / "slides").glob("*.json")}
        report = migrate.migrate(self.dir)
        for name, data in originals.items():
            self.assertEqual((self.dir / report["backup"] / "slides" / name).read_bytes(), data)


class ObjectAnimation(unittest.TestCase):
    """0.13.0 to 0.14.0: every object gets an animation, and the starting one means no effect."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.dir = self.tmp / "p.osproj"
        shutil.copytree(EXAMPLES / "lms-test-lesson.osproj", self.dir, ignore=shutil.ignore_patterns(".cache"))
        # Make it a 0.13.0 project: the version before objects had an animation at all.
        self.before = {}
        for path in sorted((self.dir / "slides").glob("*.json")):
            slide = json.loads(path.read_text(encoding="utf-8"))
            for layer in [slide["baseLayer"], *slide["layers"]]:
                for obj in layer["objects"]:
                    del obj["animation"]
            self.before[path.name] = slide
            path.write_text(json.dumps(slide, indent=2), encoding="utf-8")
        pj = self.dir / "project.json"
        project = json.loads(pj.read_text(encoding="utf-8"))
        project["schemaVersion"] = "0.13.0"
        pj.write_text(json.dumps(project, indent=2), encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_every_object_gets_no_effect_after_its_timing_and_nothing_else_changes(self):
        self.assertEqual([f.rule for f in validate.validate_project(self.dir)], ["needs-migration"])
        report = migrate.migrate(self.dir)
        self.assertEqual((report["status"], report["from"], report["to"]), ("updated", "0.13.0", "0.14.0"))
        objects = 0
        for name, was in self.before.items():
            now = json.loads((self.dir / "slides" / name).read_text(encoding="utf-8"))
            for layer in [now["baseLayer"], *now["layers"]]:
                for obj in layer["objects"]:
                    objects += 1
                    self.assertEqual(obj["animation"], {"enter": {"effect": "none", "duration": 500}, "exit": {"effect": "none", "duration": 500}})
                    keys = list(obj)
                    self.assertEqual(keys[keys.index("timing") + 1], "animation", "the new field sits after the timing")
                    del obj["animation"]
            self.assertEqual(now, was, "nothing else on the slide changes")
        self.assertGreater(objects, 60)
        self.assertTrue(any("fade" in n and "slide" in n for n in report["notes"]))
        self.assertEqual([f for f in validate.validate_project(self.dir) if f.severity == "error"], [])

    def test_an_animation_the_author_already_set_is_kept(self):
        path = self.dir / "slides" / "slide-001.json"
        slide = json.loads(path.read_text(encoding="utf-8"))
        slide["baseLayer"]["objects"][0]["animation"] = {"enter": {"effect": "fade", "duration": 800}, "exit": {"effect": "none", "duration": 500}}
        path.write_text(json.dumps(slide, indent=2), encoding="utf-8")
        migrate.migrate(self.dir)
        again = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(again["baseLayer"]["objects"][0]["animation"]["enter"], {"effect": "fade", "duration": 800})

    def test_the_old_slides_are_kept_exactly(self):
        originals = {p.name: p.read_bytes() for p in (self.dir / "slides").glob("*.json")}
        report = migrate.migrate(self.dir)
        for name, data in originals.items():
            self.assertEqual((self.dir / report["backup"] / "slides" / name).read_bytes(), data)


if __name__ == "__main__":
    unittest.main(verbosity=1)
