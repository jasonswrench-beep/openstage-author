# SPDX-License-Identifier: Apache-2.0
"""Slide sets: slides that can be handed to someone else as one file, and taken in from one.

A slide set is a zip file (the editor calls it a set of slides, and saves it with the ending .osset) holding some slides of a course with everything they need to work
on their own: the variables and rules that make a game play, the people of a scenario, the pictures and sounds, and where those came from. Nothing in it is ever run:
it is slides in the course format (JSON), pictures, sounds, captions and plain text. docs/slide-sets.md is the description of the format. This file is the one place that
decides what a good set is, so the editor, the command line and the tests all agree.

Command line (each prints one line of JSON; "ok" says whether it worked, and if not "message" says why in plain words):
  slideset.py make PROJECT_DIR --slides ID,ID,... --out FILE --title T --author A --licence L [--description D]
  slideset.py read FILE --stage DIR      checks a set and unpacks it into DIR (as a small project), and says what is in it
  slideset.py check FILE                 checks a set and says what is in it, leaving nothing behind
"""
import argparse
import copy
import datetime
import json
import os
import pathlib
import re
import shutil
import stat
import struct
import sys
import tempfile
import zipfile
import zlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import migrate  # noqa: E402
import validate  # noqa: E402

SET_VERSION = 1

MAX_SLIDES = 200
MAX_FILES = 3000
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_SET_BYTES = 250 * 1024 * 1024
MAX_TEXT_BYTES = 8 * 1024 * 1024

SET_ID = re.compile(r"^[a-z][a-z0-9-]{2,59}$")
ITEM_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
VERSION = re.compile(r"^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$")

# What may travel in a set besides slides: pictures, sounds, video and captions. Nothing that can run, no web pages, no scripts, and no SVG (which can hold script).
PICTURE_TYPES = (".png", ".webp", ".jpg", ".jpeg", ".gif")
OTHER_TYPES = (".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".vtt")
ASSET_TYPES = PICTURE_TYPES + OTHER_TYPES
ASSET_FOLDERS = ("images", "audio", "video", "captions")

VALUE_REFERENCE = re.compile(r"\{\{([^{}\n]{1,80})\}\}")


class SetError(Exception):
    """Something is wrong with a set; the message says what, for the person who has to put it right."""


# ---- the manifest

def _words(raw, key, low=0, high=300, required=False):
    value = raw.get(key, "")
    if not isinstance(value, str):
        raise SetError(f"set.json: \"{key}\" must be words.")
    value = value.strip()
    if required and not value:
        raise SetError(f"set.json: \"{key}\" is needed.")
    if len(value) > high:
        raise SetError(f"set.json: \"{key}\" is too long (the most is {high} letters).")
    if len(value) < low:
        raise SetError(f"set.json: \"{key}\" is too short.")
    if any(ord(c) < 32 for c in value):
        raise SetError(f"set.json: \"{key}\" has a character that cannot be shown.")
    return value


def clean_manifest(raw):
    """The manifest with every field checked. Raises SetError saying what is wrong."""
    if not isinstance(raw, dict):
        raise SetError("set.json must hold one object.")
    if raw.get("setVersion") != SET_VERSION:
        raise SetError(f"set.json says setVersion {raw.get('setVersion')!r}, and this program reads setVersion {SET_VERSION}. The set may be newer than this program: update OpenStage Author.")
    sid = raw.get("id")
    if not isinstance(sid, str) or not SET_ID.match(sid):
        raise SetError("set.json: \"id\" must be 3 to 60 lower case letters, digits and hyphens, starting with a letter.")
    version = raw.get("schemaVersion")
    if not isinstance(version, str) or not VERSION.match(version):
        raise SetError("set.json: \"schemaVersion\" must look like 0.31.0: the course format the slides are in.")
    stage = raw.get("stage")
    if not (isinstance(stage, dict) and all(isinstance(stage.get(k), int) and 100 <= stage[k] <= 8000 for k in ("width", "height"))):
        raise SetError("set.json: \"stage\" must give the width and height the slides were made for.")
    slides = raw.get("slides")
    if not isinstance(slides, list) or not 1 <= len(slides) <= MAX_SLIDES or not all(isinstance(s, str) and ITEM_ID.match(s) for s in slides):
        raise SetError(f"set.json: \"slides\" must list from 1 to {MAX_SLIDES} slide ids.")
    if len(set(slides)) != len(slides):
        raise SetError("set.json: a slide is listed twice.")
    completion = raw.get("completion")
    if completion not in (None, "last"):
        raise SetError("set.json: \"completion\" must be \"last\" or left out.")
    variables = raw.get("variables", [])
    characters = raw.get("characters", [])
    if not isinstance(variables, list) or not isinstance(characters, list):
        raise SetError("set.json: \"variables\" and \"characters\" must be lists.")
    created = raw.get("created", "")
    if created and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(created)):
        raise SetError("set.json: \"created\" must be a date such as 2026-10-21.")
    return {
        "setVersion": SET_VERSION,
        "id": sid,
        "title": _words(raw, "title", 1, 80, True),
        "description": _words(raw, "description", 0, 400),
        "author": _words(raw, "author", 0, 80),
        "licence": _words(raw, "licence", 1, 300, True),
        "created": created,
        "schemaVersion": version,
        "stage": {"width": stage["width"], "height": stage["height"]},
        "completion": completion,
        "slides": slides,
        "variables": variables,
        "characters": characters,
    }


# ---- looking inside a zip file

def _member_name_ok(name):
    if "\\" in name or name.startswith("/") or ":" in name:
        return False
    parts = [p for p in name.split("/") if p != ""]
    return bool(parts) and len(parts) <= 5 and all(p not in (".", "..") and not p.startswith(".") and len(p) <= 100 for p in parts)


def _asset_ok(rel):
    parts = rel.split("/")
    return len(parts) >= 3 and parts[0] == "assets" and parts[1] in ASSET_FOLDERS and rel.lower().endswith(ASSET_TYPES)


def _open_zip(zip_path):
    try:
        archive = zipfile.ZipFile(zip_path)
    except (zipfile.BadZipFile, OSError):
        raise SetError("That is not a set of slides that can be opened: it is not a zip file.") from None
    infos = [i for i in archive.infolist() if not i.is_dir()]
    if len(infos) > MAX_FILES:
        raise SetError("That zip file holds far more files than a set of slides does.")
    return archive, infos


def _unpack(zip_path, into=None):
    """Read a set. Returns (manifest, slides, credits, assets) where `assets` maps a path to its bytes, or to None if `into` was given and the file was written there.
    Everything is checked before anything is kept."""
    archive, infos = _open_zip(zip_path)
    with archive:
        names = {i.filename for i in infos}
        if "set.json" not in names:
            raise SetError("There is no set.json in this zip file, so it is not a set of slides.")
        total = 0
        seen = set()
        for info in infos:
            name = info.filename
            if not _member_name_ok(name):
                raise SetError(f"The zip file holds a file with a name that is not allowed: {name[:80]}")
            if stat.S_ISLNK(info.external_attr >> 16):
                raise SetError("The zip file holds a link, which a set may not.")
            if name.lower() in seen:
                raise SetError("The zip file holds two files whose names differ only by capital letters.")
            seen.add(name.lower())
            if name in ("set.json", "assets.json") or (name.startswith("slides/") and name.endswith(".json") and name.count("/") == 1):
                limit = MAX_TEXT_BYTES
            elif name in ("README.txt", "README.md"):
                limit = MAX_TEXT_BYTES
            elif _asset_ok(name):
                limit = MAX_FILE_BYTES
            else:
                raise SetError(f"A set holds only slides, set.json, pictures, sounds, video and captions, and this zip file holds {name[:80]}.")
            if info.file_size > limit:
                raise SetError(f"{name} is larger than a file in a set may be.")
            total += info.file_size
        if total > MAX_SET_BYTES:
            raise SetError(f"The set is larger than {MAX_SET_BYTES // (1024 * 1024)} MB.")

        def read(name, limit):
            try:
                with archive.open(name) as f:
                    data = f.read(limit + 1)
            except (zipfile.BadZipFile, NotImplementedError, RuntimeError, zlib.error):
                raise SetError("That zip file is damaged, or is locked with a password, so it cannot be opened.") from None
            if len(data) > limit:
                raise SetError(f"{name} is larger than a file in a set may be.")
            return data

        def read_json(name, what):
            try:
                return json.loads(read(name, MAX_TEXT_BYTES).decode("utf-8-sig"))
            except (ValueError, UnicodeDecodeError):
                raise SetError(f"{what} cannot be read: it is not written as JSON.") from None

        manifest = clean_manifest(read_json("set.json", "set.json"))
        slides = {}
        for sid in manifest["slides"]:
            if f"slides/{sid}.json" not in names:
                raise SetError(f"set.json lists the slide {sid}, and it is not in the set.")
            slides[sid] = read_json(f"slides/{sid}.json", f"The slide {sid}")
        extra = sorted(n for n in names if n.startswith("slides/") and n != "slides/" and pathlib.PurePosixPath(n).stem not in manifest["slides"])
        if extra:
            raise SetError(f"The set holds a slide that set.json does not list: {extra[0][:80]}.")
        credits = read_json("assets.json", "assets.json").get("assets", []) if "assets.json" in names else []
        assets = {}
        for info in infos:
            if not _asset_ok(info.filename):
                continue
            data = read(info.filename, MAX_FILE_BYTES)
            if info.filename.lower().endswith(PICTURE_TYPES):
                _check_picture(info.filename, data)
            if into is not None:
                target = pathlib.Path(into) / pathlib.PurePosixPath(info.filename)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                assets[info.filename] = None
            else:
                assets[info.filename] = data
        return manifest, slides, credits, assets


def _check_picture(name, data):
    """A picture is what its name says, judged by what is inside it."""
    lower = name.lower()
    head = data[:16]
    if lower.endswith(".png"):
        ok = head.startswith(b"\x89PNG\r\n\x1a\n")
    elif lower.endswith(".webp"):
        ok = head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    elif lower.endswith((".jpg", ".jpeg")):
        ok = head.startswith(b"\xff\xd8\xff")
    else:
        ok = head[:6] in (b"GIF87a", b"GIF89a")
    if not ok:
        raise SetError(f"The picture {name} is not really a picture of the kind its name says.")


# ---- the slides of a set, and what they need

def _objects(slide):
    for layer in [slide.get("baseLayer", {})] + list(slide.get("layers", [])):
        for obj in layer.get("objects", []):
            yield obj


def _strings(value):
    """Every string in a piece of JSON, keys excluded."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)


def _references_in(html):
    """The names in {{Name}} references of a text, read in each stretch of words between tags, as the player reads them."""
    import html as htmllib
    names = []
    for stretch in re.split(r"<[^>]*>", str(html)):
        for m in VALUE_REFERENCE.finditer(htmllib.unescape(stretch)):
            n = m.group(1).strip()
            if n and n not in names:
                names.append(n)
    return names


def make(project_dir, slide_ids, out, title, author="", licence="", description=""):
    """Make a set from slides of a saved project. Returns a summary. The slides are not changed."""
    project_dir = pathlib.Path(project_dir)
    try:
        project = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise SetError("The project could not be read.") from None
    order = [s for scene in project["scenes"] for s in scene["slides"]]
    wanted = [s for s in order if s in slide_ids]
    if not wanted or len(wanted) != len(set(slide_ids)):
        raise SetError("Choose at least one slide of the course.")
    if not title.strip():
        raise SetError("A set needs a title.")
    if not licence.strip():
        raise SetError("A set needs a line saying what others may do with it (its licence), such as \"Free to use and change\".")
    slides = {}
    dropped = 0
    for sid in wanted:
        slide = json.loads((project_dir / "slides" / f"{sid}.json").read_text(encoding="utf-8"))
        for obj in _objects(slide):
            obj["provenance"] = None
            kept = []
            for t in obj.get("triggers", []):
                if t.get("action") == "jumpToSlide" and t.get("target") not in wanted:
                    dropped += 1  # a way to a slide that is not in the set goes nowhere here
                    continue
                kept.append(t)
            obj["triggers"] = kept
        if "provenance" in slide:
            slide["provenance"] = None
        slides[sid] = slide
    strings = {s for slide in slides.values() for s in _strings(slide)}
    names_shown = {n.lower() for slide in slides.values() for o in _objects(slide) if o.get("type") == "text" for n in _references_in(o.get("content", {}).get("html", ""))}
    variables = [v for v in project["variables"] if v["id"] in strings or v["name"].strip().lower() in names_shown]
    people = []
    for c in project.get("characters", []):
        used = any(c["id"] in set(_strings(o["content"])) for slide in slides.values() for o in _objects(slide) if o.get("type") in ("scenario", "input"))
        if used:
            people.append(c)
    pool = {s for slide in slides.values() for s in _strings(slide)} | {s for p in people for s in _strings(p)}
    paths = sorted(s for s in pool if s.startswith("assets/"))
    for rel in paths:
        if not _asset_ok(rel):
            raise SetError(f"{rel} is a kind of file a set cannot carry.")
        if not (project_dir / rel).is_file():
            raise SetError(f"The file {rel} is used by these slides and is not in the project.")
    all_credits = []
    if (project_dir / "assets.json").is_file():
        all_credits = json.loads((project_dir / "assets.json").read_text(encoding="utf-8")).get("assets", [])
    credits = [c for c in all_credits if c.get("path") in paths]
    manifest = {
        "setVersion": SET_VERSION,
        "id": re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:50] or "slide-set",
        "title": title.strip(), "description": description.strip(), "author": author.strip(), "licence": licence.strip(),
        "created": datetime.date.today().isoformat(),
        "schemaVersion": project["schemaVersion"],
        "stage": project["stage"],
        "completion": "last" if project.get("completion", {}).get("slides") == "last" else None,
        "slides": wanted,
        "variables": variables,
        "characters": people,
    }
    if not SET_ID.match(manifest["id"]):
        manifest["id"] = "set-" + manifest["id"]
    manifest["id"] = manifest["id"][:60]
    clean_manifest(manifest)
    out = pathlib.Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    temp = out.with_name(out.name + ".part")
    try:
        with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("set.json", json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
            for sid, slide in slides.items():
                z.writestr(f"slides/{sid}.json", json.dumps(slide, indent=2, ensure_ascii=False) + "\n")
            if credits:
                z.writestr("assets.json", json.dumps({"assets": credits}, indent=2, ensure_ascii=False) + "\n")
            for rel in paths:
                z.write(project_dir / rel, rel)
        # What was made is checked the way it will be when someone opens it, so a set that cannot be used is never handed on.
        stage = pathlib.Path(tempfile.mkdtemp(prefix="openstage-set-check-"))
        try:
            summary = read(temp, stage)
        finally:
            shutil.rmtree(stage, ignore_errors=True)
        os.replace(temp, out)
    finally:
        if temp.exists():
            temp.unlink()
    summary["dropped"] = dropped
    summary["bytes"] = out.stat().st_size
    return summary


def read(zip_path, stage=None):
    """Check a set and say what is in it. With a `stage` folder, it is unpacked there as a small project (so its slides can be checked as a course, and its pictures
    can be copied into a project). Raises SetError, with words, if it is not good."""
    own = stage is None
    stage = pathlib.Path(tempfile.mkdtemp(prefix="openstage-set-")) if own else pathlib.Path(stage)
    stage.mkdir(parents=True, exist_ok=True)
    try:
        manifest, slides, credits, assets = _unpack(zip_path, into=stage)
        # The set as a small course, so the course's own checker can judge it (and migrate it, if it is older).
        (stage / "slides").mkdir(exist_ok=True)
        project = {
            "schemaVersion": manifest["schemaVersion"],
            "meta": {"title": manifest["title"], "author": manifest["author"], "language": "en-US", "created": manifest["created"] or "2026-01-01", "modified": manifest["created"] or "2026-01-01"},
            "stage": manifest["stage"],
            "variables": manifest["variables"],
            "characters": manifest["characters"],
            "theme": {"ref": "theme.json"},
            "credits": True,
            "completion": {"slides": manifest["completion"] or "all"},
            "scenes": [{"id": "scene-set", "name": "Set", "slides": manifest["slides"]}],
        }
        (stage / "project.json").write_text(json.dumps(project, indent=2), encoding="utf-8")
        (stage / "theme.json").write_text(json.dumps(validate.default_theme(), indent=2), encoding="utf-8")
        for sid, slide in slides.items():
            (stage / "slides" / f"{sid}.json").write_text(json.dumps(slide, indent=2), encoding="utf-8")
        if credits:
            (stage / "assets.json").write_text(json.dumps({"assets": credits}, indent=2), encoding="utf-8")
        migrated = False
        found_version = tuple(int(x) for x in manifest["schemaVersion"].split("."))
        if found_version > validate.SUPPORTED_SCHEMA_VERSION:
            raise SetError(f"This set was made with a newer version of OpenStage Author (its format is {manifest['schemaVersion']}). Update OpenStage Author to use it.")
        if found_version < validate.SUPPORTED_SCHEMA_VERSION:
            report = migrate.migrate(stage)
            migrated = report.get("status") == "updated"
            shutil.rmtree(stage / ".openstage-backup", ignore_errors=True)
            project = json.loads((stage / "project.json").read_text(encoding="utf-8"))
            slides = {sid: json.loads((stage / "slides" / f"{sid}.json").read_text(encoding="utf-8")) for sid in manifest["slides"]}
        findings = validate.validate_project(stage)
        # Colours are judged against the theme the set is used with, which is not known here, so a contrast finding is a thing to look at, not a reason to refuse.
        problems = [f for f in findings if f.severity == "error" and f.rule != "contrast"]
        if problems:
            first = problems[0]
            raise SetError(f"The slides in this set have a problem that stops them being used: {first.message}. {first.detail}".strip() + (f" ({len(problems) - 1} more.)" if len(problems) > 1 else ""))
        notes = [f"{f.message} ({f.file})" for f in findings if f.rule == "contrast"][:5]
        result = {
            "ok": True,
            "set": {k: manifest[k] for k in ("id", "title", "description", "author", "licence", "created", "schemaVersion", "stage", "completion")},
            "slides": [slides[sid] for sid in manifest["slides"]],
            "variables": project["variables"],
            "characters": project["characters"],
            "assets": [{"path": rel, "bytes": (stage / rel).stat().st_size} for rel in sorted(assets)],
            "credits": credits,
            "migrated": migrated,
            "notes": notes,
            "stage": str(stage) if not own else "",
        }
        return result
    except BaseException:
        if not own:
            shutil.rmtree(stage, ignore_errors=True)
        raise
    finally:
        if own:
            shutil.rmtree(stage, ignore_errors=True)


# ---- command line

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    m = sub.add_parser("make")
    m.add_argument("project")
    m.add_argument("--slides", required=True)
    m.add_argument("--out", required=True)
    m.add_argument("--title", required=True)
    m.add_argument("--author", default="")
    m.add_argument("--licence", default="")
    m.add_argument("--description", default="")
    r = sub.add_parser("read")
    r.add_argument("file")
    r.add_argument("--stage", required=True)
    c = sub.add_parser("check")
    c.add_argument("file")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        if args.command == "make":
            answer = make(args.project, [s for s in args.slides.split(",") if s], args.out, args.title, args.author, args.licence, args.description)
        elif args.command == "read":
            answer = read(args.file, args.stage)
        else:
            answer = read(args.file)
    except SetError as e:
        answer = {"ok": False, "message": str(e)}
    print(json.dumps(answer, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
