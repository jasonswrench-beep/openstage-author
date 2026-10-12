"""Bring an OpenStage project folder up to the current format.

Usage:  python migrate.py PROJECT_DIR [--json]

A project written by an older version opens, updates, and reports what changed. Before anything
is changed, the files that will change are copied to .openstage-backup/<old version>/ inside the
project, so an update can always be undone by copying them back.

Each step takes a project from one version to the next, and steps run in order, so a project
several versions behind is brought up one version at a time. Nothing here ever downgrades: a
project from a newer version is refused.
"""
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CURRENT = "0.14.0"


def version_tuple(text):
    try:
        return tuple(int(p) for p in text.split("."))
    except (ValueError, AttributeError):
        return None


def canonical(value):
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def _insert_after(d, after, key, value):
    """A copy of d with key added straight after `after`, so files keep a readable order."""
    out = {}
    for k, v in d.items():
        out[k] = v
        if k == after and key not in d:
            out[key] = value
    if key not in out:
        out[key] = value
    return out


def step_0_1_to_0_2(project, slides, files):
    """0.1.0 to 0.2.0: projects get a theme, and slides remember their layout and background."""
    project["schemaVersion"] = "0.2.0"
    project["theme"] = {"ref": "theme.json"}
    files["theme.json"] = json.loads((ROOT / "themes" / "classic.theme.json").read_text(encoding="utf-8"))
    for name, slide in list(slides.items()):
        slide = _insert_after(slide, "duration", "layout", None)
        slide = _insert_after(slide, "layout", "background", None)
        slides[name] = slide
    return [
        "Added theme.json (the Classic theme), so the project has a design that can be switched.",
        "Slides now record the layout they were made from and a background. Both start empty, so nothing looks different.",
    ]


def step_0_2_to_0_3(project, slides, files):
    """0.2.0 to 0.3.0: slides can hold interactions. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.3.0"
    return ["Slides can now hold interactions such as tabs and flip cards. Your existing slides are unchanged."]


def step_0_3_to_0_4(project, slides, files):
    """0.3.0 to 0.4.0: more kinds of interaction. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.4.0"
    return ["Interactions can now be timelines, process circles, glossaries, pyramids and circle matrices. Your existing slides are unchanged."]


def step_0_4_to_0_5(project, slides, files):
    """0.4.0 to 0.5.0: tables and scrolling text. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.5.0"
    return ["Slides can now hold tables and scrolling text boxes. Your existing slides are unchanged."]


def step_0_5_to_0_6(project, slides, files):
    """0.5.0 to 0.6.0: input widgets and surveys. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.6.0"
    return ["Slides can now hold inputs: checkboxes, radio buttons, drop-downs, lists, and Likert and semantic differential surveys. Your existing slides are unchanged."]


def step_0_6_to_0_7(project, slides, files):
    """0.6.0 to 0.7.0: embedded video, a record of where assets came from, and a switch for the credits page."""
    project["schemaVersion"] = "0.7.0"
    project["credits"] = True
    return [
        "Projects can now embed YouTube and Vimeo videos, and keep a record of where images and media came from.",
        "Added a switch for the credits page of the published course. It starts on, and shows nothing until an asset has credit.",
    ]


def step_0_7_to_0_8(project, slides, files):
    """0.7.0 to 0.8.0: more places an asset can have come from. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.8.0"
    return ["The record of where assets came from can now name Pexels, Openverse, Wikimedia Commons, Freesound, Mixkit, SVG Repo and Libreshot. Your existing assets are unchanged."]


def step_0_8_to_0_9(project, slides, files):
    """0.8.0 to 0.9.0: the author chooses what completes a course. Existing courses keep the old rule: every slide seen."""
    project["schemaVersion"] = "0.9.0"
    rebuilt = _insert_after(project, "credits", "completion", {"slides": "all"})
    project.clear()
    project.update(rebuilt)
    return ["Added a course setting for what counts as completing the course. It starts as every slide seen, which is how your course already worked, so nothing changes until you choose otherwise."]


def step_0_9_to_0_10(project, slides, files):
    """0.9.0 to 0.10.0: results boxes and certificates. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.10.0"
    return ["Slides can now hold a results box, which shows the learner's score and each question, and a certificate for learners who pass. Your existing slides are unchanged."]


def step_0_10_to_0_11(project, slides, files):
    """0.10.0 to 0.11.0: every item of an interaction can have its own narration. Existing items start with none."""
    project["schemaVersion"] = "0.11.0"
    for name, slide in slides.items():
        for layer in [slide["baseLayer"], *slide["layers"]]:
            for obj in layer["objects"]:
                if obj.get("type") != "interaction":
                    continue
                obj["content"]["items"] = [_insert_after(item, "image", "narration", None) for item in obj["content"]["items"]]
    return ["Each item in an interaction, such as a glossary term or a flip card, can now have its own narration. Your existing items start with none, so nothing sounds different until you add some."]


def step_0_11_to_0_12(project, slides, files):
    """0.11.0 to 0.12.0: files to download. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.12.0"
    return ["Slides can now offer a file to download, such as a PDF or a Word document, with a description of what it is. Your existing slides are unchanged."]


def step_0_12_to_0_13(project, slides, files):
    """0.12.0 to 0.13.0: every object gets a timing, which says when it appears and disappears. The starting value is "always there"."""
    project["schemaVersion"] = "0.13.0"
    for slide in slides.values():
        for layer in [slide["baseLayer"], *slide["layers"]]:
            layer["objects"] = [_insert_after(obj, "triggers", "timing", {"appear": "time", "start": 0, "visibleFor": None}) for obj in layer["objects"]]
    return ["Objects can now appear and disappear at set times, or when their narration starts, and a slide can move on by itself. Your existing objects start with no timing, so nothing changes until you set some."]


def step_0_13_to_0_14(project, slides, files):
    """0.13.0 to 0.14.0: every object gets an animation, which says how it arrives and leaves. The starting value is "no effect"."""
    project["schemaVersion"] = "0.14.0"
    for slide in slides.values():
        for layer in [slide["baseLayer"], *slide["layers"]]:
            layer["objects"] = [_insert_after(obj, "timing", "animation", {"enter": {"effect": "none", "duration": 500}, "exit": {"effect": "none", "duration": 500}}) for obj in layer["objects"]]
    return ["Objects can now fade, slide or grow in when they appear, and out when they go. Your existing objects start with no effect, so nothing moves until you choose some."]


STEPS = {"0.1.0": ("0.2.0", step_0_1_to_0_2), "0.2.0": ("0.3.0", step_0_2_to_0_3), "0.3.0": ("0.4.0", step_0_3_to_0_4),
         "0.4.0": ("0.5.0", step_0_4_to_0_5), "0.5.0": ("0.6.0", step_0_5_to_0_6), "0.6.0": ("0.7.0", step_0_6_to_0_7),
         "0.7.0": ("0.8.0", step_0_7_to_0_8), "0.8.0": ("0.9.0", step_0_8_to_0_9), "0.9.0": ("0.10.0", step_0_9_to_0_10), "0.10.0": ("0.11.0", step_0_10_to_0_11), "0.11.0": ("0.12.0", step_0_11_to_0_12), "0.12.0": ("0.13.0", step_0_12_to_0_13), "0.13.0": ("0.14.0", step_0_13_to_0_14)}


def migrate(project_dir):
    """Update the project in place. Returns a report: status, from, to, changed files, notes, backup."""
    project_dir = pathlib.Path(project_dir)
    project_path = project_dir / "project.json"
    project = json.loads(project_path.read_text(encoding="utf-8"))
    start = project.get("schemaVersion")
    if start == CURRENT:
        return {"status": "current", "from": start, "to": start, "changed": [], "notes": [], "backup": None}
    if version_tuple(start) is None or (version_tuple(start) > version_tuple(CURRENT)):
        raise ValueError(f"This project is version {start}, which is newer than this program understands ({CURRENT}).")
    if start not in STEPS:
        raise ValueError(f"There is no way to update a version {start} project.")

    slide_files = {p.name: p for p in sorted((project_dir / "slides").glob("*.json"))}
    slides = {name: json.loads(p.read_text(encoding="utf-8")) for name, p in slide_files.items()}

    # Back up everything that exists and might change, before changing it.
    backup = project_dir / ".openstage-backup" / start
    n = 2
    while backup.exists():
        backup = project_dir / ".openstage-backup" / f"{start}-{n}"
        n += 1
    (backup / "slides").mkdir(parents=True)
    shutil.copy2(project_path, backup / "project.json")
    for name, p in slide_files.items():
        shutil.copy2(p, backup / "slides" / name)
    if (project_dir / "theme.json").exists():
        shutil.copy2(project_dir / "theme.json", backup / "theme.json")

    notes, files, version = [], {}, start
    while version != CURRENT:
        nxt, step = STEPS[version]
        notes += step(project, slides, files)
        version = nxt

    written = ["project.json"]
    project_path.write_text(canonical(project), encoding="utf-8")
    for name, slide in slides.items():
        (project_dir / "slides" / name).write_text(canonical(slide), encoding="utf-8")
        written.append(f"slides/{name}")
    for rel, data in files.items():
        (project_dir / rel).write_text(canonical(data), encoding="utf-8")
        written.append(rel)
    return {"status": "updated", "from": start, "to": CURRENT, "changed": written, "notes": notes,
            "backup": str(backup.relative_to(project_dir)).replace("\\", "/")}


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1:
        print("Usage: migrate.py PROJECT_DIR [--json]")
        return 2
    try:
        report = migrate(args[0])
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"Could not update the project: {exc}", file=sys.stderr)
        return 1
    if "--json" in argv:
        print(json.dumps(report, indent=2))
    elif report["status"] == "current":
        print(f"Already up to date (version {report['to']}).")
    else:
        print(f"Updated from version {report['from']} to {report['to']}.")
        for note in report["notes"]:
            print(f"  - {note}")
        print(f"The old files are kept in {report['backup']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
