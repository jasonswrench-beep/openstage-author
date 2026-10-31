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
CURRENT = "0.44.0"


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


def step_0_14_to_0_15(project, slides, files):
    """0.14.0 to 0.15.0: an object can be locked in the editor. Nothing in an existing project has to change: no flag means unlocked."""
    project["schemaVersion"] = "0.15.0"
    return ["Objects can now be locked in the editor, so they are not moved or deleted by accident. All your existing objects are unlocked."]


def step_0_15_to_0_16(project, slides, files):
    """0.15.0 to 0.16.0: more kinds of quiz question. Existing questions are multiple choice, which has not changed."""
    project["schemaVersion"] = "0.16.0"
    return ["Quiz questions can now be multiple response, short answer, numeric, fill in the blanks (typed, from a drop-down, or by dragging words), matching, sequencing or a hotspot, and a question with several parts can earn part of its points. Your existing questions are unchanged."]


def step_0_16_to_0_17(project, slides, files):
    """0.16.0 to 0.17.0: objects can be grouped in the editor. Nothing in an existing project has to change: no tag means not in a group."""
    project["schemaVersion"] = "0.17.0"
    return ["Objects can now be grouped in the editor, so they are selected, moved and copied together. None of your existing objects are in a group."]


def step_0_17_to_0_18(project, slides, files):
    """0.17.0 to 0.18.0: a rule can add to a number variable, a hotspot is defined (a transparent button with no content of its own),
    provenance can name a capture step, and a project can list what to leave out of a package's source copy. Only the hotspot
    can touch an existing project: one whose content was never defined is emptied, because its content was never used."""
    emptied = 0
    for slide in slides.values():
        for layer in [slide["baseLayer"], *slide["layers"]]:
            for obj in layer["objects"]:
                if obj["type"] == "hotspot" and obj["content"]:
                    obj["content"] = {}
                    emptied += 1
    project["schemaVersion"] = "0.18.0"
    notes = ["A rule can now add to a number variable, such as a count of tries."]
    if emptied:
        notes.append(f"{emptied} hotspot{' had' if emptied == 1 else 's had'} content that was never used, so it was cleared. A hotspot is a named, transparent button and has no content of its own.")
    return notes


def step_0_18_to_0_19(project, slides, files):
    """0.18.0 to 0.19.0: a video can have an audio description. Nothing in an existing project has to change: no description means none."""
    project["schemaVersion"] = "0.19.0"
    return ["A video can now have an audio description: words, and a voice, that say what the picture shows. None of your videos has one."]


def step_0_19_to_0_20(project, slides, files):
    """0.19.0 to 0.20.0: a theme can carry a logo. Nothing in an existing project has to change: no logo means none."""
    project["schemaVersion"] = "0.20.0"
    return ["A theme can now carry a logo, shown in a corner of every slide. None of your themes has one."]


def step_0_20_to_0_21(project, slides, files):
    """0.20.0 to 0.21.0: scenarios, and a cast of characters with a way for the learner to choose one. Nothing in an existing project has to change:
    no cast means no characters, and no scenario object means no scenario."""
    project["schemaVersion"] = "0.21.0"
    return ["A slide can now hold a branching scenario, and the project can have a cast of characters, each with a name, a picture and a voice. Your course has neither yet."]


def step_0_21_to_0_22(project, slides, files):
    """0.21.0 to 0.22.0: an icon object, an optional icon on a button, and the rule actions next slide, previous slide and replay this slide.
    Nothing in an existing project has to change: no icon means none, and no rule uses the new actions."""
    project["schemaVersion"] = "0.22.0"
    return ["A slide can now hold an icon, a button can show one before its words, and a rule can go to the next or previous slide or replay the slide it is on. Your course uses none of these yet."]


def step_0_22_to_0_23(project, slides, files):
    """0.22.0 to 0.23.0: an object can appear and go at moments in a video or audio clip (timing.appear "media"). Nothing in an existing
    project has to change: every timing there is says "time" or "narration", and neither is touched."""
    project["schemaVersion"] = "0.23.0"
    return ["An object can now appear and go at moments in a video or an audio clip. None of your objects does yet."]


def step_0_23_to_0_24(project, slides, files):
    """0.23.0 to 0.24.0: a look (an object state) can carry a spoken message, `announce`, which a screen reader says when a rule applies the
    look. Nothing in an existing project has to change: no look has one, and a look that did not name a message says nothing, as before."""
    project["schemaVersion"] = "0.24.0"
    return ["A look an object can take (for instance when the pointer is over it, or when a rule changes it) can now have a spoken message for screen reader users. None of your looks has one yet."]


def step_0_24_to_0_25(project, slides, files):
    """0.24.0 to 0.25.0: slides and shapes imported from a PowerPoint deck can record where they came from and what they looked like when they were
    imported (provenance), and the project can list its source decks. Nothing in an existing project has to change: nothing was imported before."""
    project["schemaVersion"] = "0.25.0"
    return ["Slides can now be imported from a PowerPoint deck, and brought up to date when the deck changes. None of your slides came from a deck."]


def step_0_25_to_0_26(project, slides, files):
    """0.25.0 to 0.26.0: a picture or sound made by an AI service is credited as such ("generated", with the service, model, words and time),
    and a narration's voice can name an engine other than the built-in one ("openai:alloy"). Nothing in an existing project has to change:
    a voice with no engine in its name is still the built-in one, and nothing was generated before."""
    project["schemaVersion"] = "0.26.0"
    return ["Pictures and sounds can now be made with an AI service you have a key for, and narration can use other voices. Nothing in your course is made that way yet."]


def step_0_27_to_0_28(project, slides, files):
    """0.27.0 to 0.28.0: an object can carry a suggested description (accessibility `altSuggestion`) that the computer worked out and the author has not approved. The course
    never uses it. Nothing in an existing project has to change: no object has one."""
    project["schemaVersion"] = "0.28.0"
    return []


def step_0_28_to_0_29(project, slides, files):
    """0.28.0 to 0.29.0: a person in the cast can have poses (more pictures of them, `poses`) and remember which character pack they came from (`library`), and a line of
    a scenario can show its speaker in one of their poses (`pose`). Nothing in an existing project has to change: no person has poses and no line has a pose."""
    project["schemaVersion"] = "0.29.0"
    return []


def step_0_29_to_0_30(project, slides, files):
    """0.29.0 to 0.30.0: a shape can be a speech or thought bubble (`shape` of `speech` or `thought`, with a `tail` on the `left` or `right`), and a text object can sit in one
    (`bubble` and `tail` in its content). Nothing in an existing project has to change: no shape is one and no text has one."""
    project["schemaVersion"] = "0.30.0"
    return []


def step_0_30_to_0_31(project, slides, files):
    """0.30.0 to 0.31.0: A text object can show a value that changes while the course is played: it holds {{Name}}, naming a variable or one of the values the course works out ($score, $possible, $percent, $answered, $questions, $correct). Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.31.0"
    return []


def step_0_31_to_0_32(project, slides, files):
    """0.31.0 to 0.32.0: Adds the timer: a countdown object, the timerEnd event and the stopTimer action. Nothing in an older course changes. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.32.0"
    return []


def step_0_32_to_0_33(project, slides, files):
    """0.32.0 to 0.33.0: Adds question banks (the optional banks of project.json: runs of slides of which each learner is shown some, picked at random) and the optional shuffle of a multiple choice or multiple response question. Nothing in an older course changes. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.33.0"
    return []


def step_0_33_to_0_34(project, slides, files):
    """0.33.0 to 0.34.0: Adds hideNavigation on a slide: the course's Back and Next are not shown on it. Nothing in an older course changes. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.34.0"
    return []


def step_0_34_to_0_35(project, slides, files):
    """0.34.0 to 0.35.0: Adds timing that waits for the learner (appear click, with a step), and the text style keys verticalAlign, paddingX, paddingY, autoFit and paragraphSpacing. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.35.0"
    return []


def step_0_35_to_0_36(project, slides, files):
    """0.35.0 to 0.36.0: Adds autoSteps on a slide: the steps of Show next item come by themselves, one after another, instead of waiting for presses. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.36.0"
    return []


def step_0_36_to_0_37(project, slides, files):
    """0.36.0 to 0.37.0: Adds the optional transition of a slide: how the slide arrives and how it leaves (the same effects as an object's animation). Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.37.0"
    return []


def step_0_37_to_0_38(project, slides, files):
    """0.37.0 to 0.38.0: Adds the optional until of an object's timing: the object goes away when the learner shows a step (the way in PowerPoint an exit effect waits for a click). Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.38.0"
    return []


def step_0_38_to_0_39(project, slides, files):
    """0.38.0 to 0.39.0: Adds animation and notes to the record a slide imported from PowerPoint keeps of what the import made, so a changed deck's animation and speaker notes can be brought forward. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.39.0"
    return []


def step_0_39_to_0_40(project, slides, files):
    """0.39.0 to 0.40.0: Adds four wipe effects (wipeLeft, wipeRight, wipeTop, wipeBottom) to the effects an object or a slide can arrive or leave with (how a Wipe in PowerPoint comes across). Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.40.0"
    return []


def step_0_40_to_0_41(project, slides, files):
    """0.40.0 to 0.41.0: Adds the optional paragraphs of a text object's timing: a timing for each paragraph or list item, so a text can come in or go away one paragraph at a time (how a PowerPoint text that builds by paragraph comes across). Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.41.0"
    return []


def step_0_41_to_0_42(project, slides, files):
    """0.41.0 to 0.42.0: Adds two kinds of input, slider and dial: a number the learner sets between a lowest and a highest value, saved in a number variable (min, max, step, and optionally unit, startLabel, endLabel and showValue). Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.42.0"
    return []


def step_0_42_to_0_43(project, slides, files):
    """0.42.0 to 0.43.0: Adds the optional enlargeable of a picture (an image object's content): true gives the picture an Enlarge button that opens it as big as the window allows. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.43.0"
    return []


def step_0_43_to_0_44(project, slides, files):
    """0.43.0 to 0.44.0: Adds the labeledGraphic kind of interaction: a picture (content.graphic) with a numbered marker for each item, placed by the item's x and y as percentages of the picture. Nothing in an existing project has to change."""
    project["schemaVersion"] = "0.44.0"
    return []


def step_0_26_to_0_27(project, slides, files):
    """0.26.0 to 0.27.0: a slide the Capture module made from a recorded step can record what was made (provenance `base`: the slide's name, the picture
    it was made with, and a fingerprint of each object it made), so that when the steps change the lesson can be brought up to date without losing what the author
    changed. Nothing in an existing project has to change: no slide has one, and a slide without one is left alone when a lesson is brought up to date."""
    project["schemaVersion"] = "0.27.0"
    return []


STEPS = {"0.1.0": ("0.2.0", step_0_1_to_0_2), "0.2.0": ("0.3.0", step_0_2_to_0_3), "0.3.0": ("0.4.0", step_0_3_to_0_4),
         "0.4.0": ("0.5.0", step_0_4_to_0_5), "0.5.0": ("0.6.0", step_0_5_to_0_6), "0.6.0": ("0.7.0", step_0_6_to_0_7),
         "0.7.0": ("0.8.0", step_0_7_to_0_8), "0.8.0": ("0.9.0", step_0_8_to_0_9), "0.9.0": ("0.10.0", step_0_9_to_0_10), "0.10.0": ("0.11.0", step_0_10_to_0_11), "0.11.0": ("0.12.0", step_0_11_to_0_12), "0.12.0": ("0.13.0", step_0_12_to_0_13), "0.13.0": ("0.14.0", step_0_13_to_0_14), "0.14.0": ("0.15.0", step_0_14_to_0_15), "0.15.0": ("0.16.0", step_0_15_to_0_16), "0.16.0": ("0.17.0", step_0_16_to_0_17), "0.17.0": ("0.18.0", step_0_17_to_0_18), "0.18.0": ("0.19.0", step_0_18_to_0_19), "0.19.0": ("0.20.0", step_0_19_to_0_20), "0.20.0": ("0.21.0", step_0_20_to_0_21), "0.21.0": ("0.22.0", step_0_21_to_0_22), "0.22.0": ("0.23.0", step_0_22_to_0_23), "0.23.0": ("0.24.0", step_0_23_to_0_24), "0.24.0": ("0.25.0", step_0_24_to_0_25), "0.25.0": ("0.26.0", step_0_25_to_0_26), "0.26.0": ("0.27.0", step_0_26_to_0_27), "0.27.0": ("0.28.0", step_0_27_to_0_28), "0.28.0": ("0.29.0", step_0_28_to_0_29), "0.29.0": ("0.30.0", step_0_29_to_0_30), "0.30.0": ("0.31.0", step_0_30_to_0_31), "0.31.0": ("0.32.0", step_0_31_to_0_32), "0.32.0": ("0.33.0", step_0_32_to_0_33), "0.33.0": ("0.34.0", step_0_33_to_0_34), "0.34.0": ("0.35.0", step_0_34_to_0_35), "0.35.0": ("0.36.0", step_0_35_to_0_36), "0.36.0": ("0.37.0", step_0_36_to_0_37), "0.37.0": ("0.38.0", step_0_37_to_0_38), "0.38.0": ("0.39.0", step_0_38_to_0_39), "0.39.0": ("0.40.0", step_0_39_to_0_40), "0.40.0": ("0.41.0", step_0_40_to_0_41), "0.41.0": ("0.42.0", step_0_41_to_0_42), "0.42.0": ("0.43.0", step_0_42_to_0_43), "0.43.0": ("0.44.0", step_0_43_to_0_44)}


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
