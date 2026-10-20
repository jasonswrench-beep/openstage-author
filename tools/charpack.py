# SPDX-License-Identifier: Apache-2.0
"""Character packs: checking them, listing the ones on this computer, installing one from a zip file, and taking one away.

A character pack is a folder of pictures of people (so a course can show them in a scenario or on a slide) and a pack.json that says who they are.
Packs are data only: pictures and words. Nothing in one is ever run, and a picture that is not really a PNG or WebP picture is refused.
docs/character-packs.md is the description of the format. This file is the one place that decides what a good pack is, so the editor, the
command line and the tool that makes packs all agree.

Command line (each prints one line of JSON; "ok" says whether it worked, and if not "message" says why in plain words):
  charpack.py list    --bundled DIR --yours DIR
  charpack.py install ZIP --bundled DIR --yours DIR
  charpack.py remove  ID  --yours DIR
  charpack.py check   FOLDER
"""
import argparse
import json
import os
import pathlib
import re
import shutil
import stat
import struct
import sys
import zipfile
import zlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import pngio  # noqa: E402

PACK_VERSION = 1

MAX_PEOPLE = 40
MAX_POSES = 40
MAX_PICTURE_BYTES = 3 * 1024 * 1024
MAX_PACK_BYTES = 120 * 1024 * 1024
MAX_FILES = 2000
MAX_TEXT_BYTES = 1024 * 1024
MIN_SIDE, MAX_SIDE = 16, 4096

PACK_ID = re.compile(r"^[a-z][a-z0-9-]{2,39}$")
PERSON_ID = re.compile(r"^[a-z][a-z0-9-]{0,29}$")
VERSION = re.compile(r"^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$")
FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$")
VOICES = ("female", "male", "any")
PICTURE_TYPES = (".png", ".webp")

# The poses a pack is encouraged to use the names of, so the same words mean the same thing from one person to the next. A pack may add its own.
STANDARD_POSES = {
    "neutral": "Standing, relaxed",
    "welcome": "Waving hello",
    "explain": "Explaining, hands open",
    "present-left": "Presenting, arm out to the left",
    "present-right": "Presenting, arm out to the right",
    "think": "Thinking, hand to chin",
    "arms-crossed": "Arms crossed",
    "point": "Pointing",
    "hands-together": "Hands together",
    "stop": "Hand up, palm out",
    "side": "Seen from the side",
}


class PackError(Exception):
    """Something is wrong with a pack; the message says what, for the person who has to put it right."""


# ---- looking inside a picture

def _webp_size(data):
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise PackError("not a WebP picture")
    kind = data[12:16]
    if kind == b"VP8 ":
        if data[23:26] != b"\x9d\x01\x2a":
            raise PackError("not a WebP picture")
        w, h = struct.unpack("<HH", data[26:30])
        return w & 0x3FFF, h & 0x3FFF
    if kind == b"VP8L":
        if data[20] != 0x2F:
            raise PackError("not a WebP picture")
        bits = struct.unpack("<I", data[21:25])[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if kind == b"VP8X":
        return int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1
    raise PackError("not a WebP picture")


def picture_size(name, data):
    """The (width, height) of a picture file, judged by what is inside it and not by what it is called."""
    try:
        if name.lower().endswith(".png"):
            return pngio.size_of(data)
        return _webp_size(data)
    except (PackError, pngio.PngError, struct.error):
        raise PackError(f"{name} is not a real {'PNG' if name.lower().endswith('.png') else 'WebP'} picture") from None


# ---- the manifest

def _text(obj, key, where, low=0, high=300, required=False):
    value = obj.get(key, "")
    if not isinstance(value, str):
        raise PackError(f"{where}: \"{key}\" must be words.")
    value = value.strip()
    if required and not value:
        raise PackError(f"{where}: \"{key}\" is needed.")
    if len(value) > high:
        raise PackError(f"{where}: \"{key}\" is too long (the most is {high} letters).")
    if len(value) < low:
        raise PackError(f"{where}: \"{key}\" is too short.")
    if any(ord(c) < 32 for c in value):
        raise PackError(f"{where}: \"{key}\" has a character that cannot be shown.")
    return value


def _web(value, where, key):
    if value and not re.match(r"^https?://\S+$", value):
        raise PackError(f"{where}: \"{key}\" must be a web address that starts with http:// or https://, or be empty.")
    return value


def _path(obj, key, where):
    raw = obj.get(key)
    if not isinstance(raw, str) or not raw:
        raise PackError(f"{where}: \"{key}\" must name a picture file in the pack.")
    parts = raw.split("/")
    if len(parts) > 3 or any(not FILE_NAME.match(p) or p in (".", "..") or p.endswith((" ", ".")) for p in parts):
        raise PackError(f"{where}: \"{raw}\" is not a plain place inside the pack.")
    if not raw.lower().endswith(PICTURE_TYPES):
        raise PackError(f"{where}: \"{raw}\" must be a .png or .webp picture.")
    return raw


def clean_manifest(raw):
    """The manifest as the editor uses it, with every field checked. Raises PackError saying what is wrong."""
    if not isinstance(raw, dict):
        raise PackError("pack.json must hold one object.")
    if raw.get("packVersion") != PACK_VERSION:
        raise PackError(f"pack.json says packVersion {raw.get('packVersion')!r}, and this program reads packVersion {PACK_VERSION}. The pack may be newer than this program: update OpenStage Author.")
    pid = raw.get("id")
    if not isinstance(pid, str) or not PACK_ID.match(pid):
        raise PackError("pack.json: \"id\" must be 3 to 40 lower case letters, digits and hyphens, starting with a letter.")
    version = raw.get("version")
    if not isinstance(version, str) or not VERSION.match(version):
        raise PackError("pack.json: \"version\" must look like 1.0.0.")
    credit = raw.get("credit")
    if not isinstance(credit, dict):
        raise PackError("pack.json: \"credit\" is needed: who made the pictures and under what licence.")
    cleaned_credit = {
        "creator": _text(credit, "creator", "credit", 1, 80, True),
        "creatorUrl": _web(_text(credit, "creatorUrl", "credit", 0, 300), "credit", "creatorUrl"),
        "licence": _text(credit, "licence", "credit", 1, 300, True),
        "url": _web(_text(credit, "url", "credit", 1, 300, True), "credit", "url"),
    }
    people_raw = raw.get("people")
    if not isinstance(people_raw, list) or not 1 <= len(people_raw) <= MAX_PEOPLE:
        raise PackError(f"pack.json: \"people\" must list from 1 to {MAX_PEOPLE} people.")
    people, seen = [], set()
    for i, p in enumerate(people_raw, 1):
        if not isinstance(p, dict):
            raise PackError(f"Person {i} must be an object.")
        who = f"Person {i}"
        person_id = p.get("id")
        if not isinstance(person_id, str) or not PERSON_ID.match(person_id) or person_id == "you":
            raise PackError(f"{who}: \"id\" must be 1 to 30 lower case letters, digits and hyphens, starting with a letter, and not \"you\".")
        if person_id in seen:
            raise PackError(f"{who}: the id \"{person_id}\" is used twice.")
        seen.add(person_id)
        who = f"Person \"{person_id}\""
        name = _text(p, "name", who, 1, 40, True)
        voice = p.get("voice", "any")
        if voice not in VOICES:
            raise PackError(f"{who}: \"voice\" must be one of {', '.join(VOICES)}.")
        poses_raw = p.get("poses", [])
        if not isinstance(poses_raw, list) or len(poses_raw) > MAX_POSES:
            raise PackError(f"{who}: \"poses\" must be a list of at most {MAX_POSES}.")
        poses, pose_seen = [], set()
        for j, pose in enumerate(poses_raw, 1):
            if not isinstance(pose, dict):
                raise PackError(f"{who}: pose {j} must be an object.")
            pose_id = pose.get("id")
            if not isinstance(pose_id, str) or not PERSON_ID.match(pose_id):
                raise PackError(f"{who}: pose {j} needs an \"id\" of 1 to 30 lower case letters, digits and hyphens.")
            if pose_id in pose_seen:
                raise PackError(f"{who}: the pose id \"{pose_id}\" is used twice.")
            pose_seen.add(pose_id)
            where = f"{who}, pose \"{pose_id}\""
            poses.append({
                "id": pose_id,
                "label": _text(pose, "label", where, 1, 60, True),
                "alt": _text(pose, "alt", where, 1, 300, True),
                "file": _path(pose, "file", where),
            })
        people.append({
            "id": person_id,
            "name": name,
            "role": _text(p, "role", who, 0, 80),
            "voice": voice,
            "alt": _text(p, "alt", who, 1, 300, True),
            "head": _path(p, "head", who),
            "poses": poses,
        })
    return {
        "packVersion": PACK_VERSION,
        "id": pid,
        "title": _text(raw, "title", "pack.json", 1, 80, True),
        "version": version,
        "description": _text(raw, "description", "pack.json", 0, 400),
        "credit": cleaned_credit,
        "people": people,
    }


def files_named(manifest):
    """Every picture file the manifest names, as the places inside the pack."""
    out = []
    for p in manifest["people"]:
        out.append(p["head"])
        out.extend(pose["file"] for pose in p["poses"])
    return out


def check_pack(folder):
    """Check a pack folder. Returns the cleaned manifest; raises PackError, with words, if the pack is not good."""
    folder = pathlib.Path(folder)
    manifest_file = folder / "pack.json"
    if not manifest_file.is_file():
        raise PackError("There is no pack.json in this folder.")
    if manifest_file.stat().st_size > MAX_TEXT_BYTES:
        raise PackError("pack.json is far larger than a pack's description should be.")
    try:
        raw = json.loads(manifest_file.read_text(encoding="utf-8-sig"))
    except (ValueError, UnicodeDecodeError):
        raise PackError("pack.json cannot be read: it is not written as JSON.") from None
    manifest = clean_manifest(raw)
    total = 0
    names = files_named(manifest)
    if len(set(names)) != len(names):
        raise PackError("Two pictures in pack.json are the same file.")
    root = folder.resolve()
    for rel in names:
        target = (folder / rel).resolve()
        if root not in target.parents or not target.is_file():
            raise PackError(f"The picture {rel} is not in the pack.")
        size = target.stat().st_size
        if size > MAX_PICTURE_BYTES:
            raise PackError(f"The picture {rel} is larger than {MAX_PICTURE_BYTES // (1024 * 1024)} MB.")
        total += size
        with open(target, "rb") as handle:
            head = handle.read(64)
        w, h = picture_size(rel, head)
        if not (MIN_SIDE <= w <= MAX_SIDE and MIN_SIDE <= h <= MAX_SIDE):
            raise PackError(f"The picture {rel} is {w} by {h}; a picture in a pack must be from {MIN_SIDE} to {MAX_SIDE} points each way.")
    if total > MAX_PACK_BYTES:
        raise PackError(f"The pictures add up to more than {MAX_PACK_BYTES // (1024 * 1024)} MB.")
    manifest["bytes"] = total
    return manifest


# ---- the packs on this computer

def list_packs(bundled, yours):
    """Every pack in the two folders. `packs` are the good ones (the ones that came with the program first), `broken` are folders that
    look like packs but cannot be used, with why."""
    packs, broken, ids = [], [], set()
    for source, folder in (("bundled", bundled), ("yours", yours)):
        if not folder or not pathlib.Path(folder).is_dir():
            continue
        for sub in sorted(pathlib.Path(folder).iterdir(), key=lambda p: p.name.lower()):
            if not sub.is_dir() or sub.name.startswith(".") or not (sub / "pack.json").is_file():
                continue
            try:
                manifest = check_pack(sub)
            except PackError as e:
                broken.append({"folder": sub.name, "source": source, "message": str(e)})
                continue
            except OSError as e:
                broken.append({"folder": sub.name, "source": source, "message": f"The folder could not be read: {e.strerror or e}"})
                continue
            if manifest["id"] in ids:
                broken.append({"folder": sub.name, "source": source, "message": f"Another pack already has the id \"{manifest['id']}\", so this one is not used."})
                continue
            ids.add(manifest["id"])
            manifest["source"] = source
            manifest["folder"] = sub.name
            packs.append(manifest)
    return {"ok": True, "packs": packs, "broken": broken}


def find_pack(pack_id, bundled, yours):
    """The folder of the good pack with this id, and where it came from, or None."""
    if not isinstance(pack_id, str) or not PACK_ID.match(pack_id):
        return None
    for pack in list_packs(bundled, yours)["packs"]:
        if pack["id"] == pack_id:
            return pathlib.Path(bundled if pack["source"] == "bundled" else yours) / pack["folder"], pack["source"]
    return None


# ---- installing from a zip file

def _member_ok(name, top):
    """Whether a name inside a zip is a plain place inside the pack. `top` is the folder the pack sits in inside the zip, or ""."""
    if "\\" in name or name.startswith("/") or ":" in name:
        return False
    parts = [p for p in name.split("/") if p != ""]
    if top:
        if not parts or parts[0] != top:
            return False
        parts = parts[1:]
    return bool(parts) and len(parts) <= 3 and all(p not in (".", "..") and not p.startswith(".") and len(p) <= 100 for p in parts)


def _find_top(names):
    """Where pack.json is inside a zip: at the top, or inside the one folder that holds everything. Returns "" or the folder name; raises if there is no pack.json."""
    if "pack.json" in names:
        return ""
    tops = {n.split("/")[0] for n in names if "/" in n}
    for top in sorted(tops):
        if f"{top}/pack.json" in names and all(n == top or n.startswith(top + "/") for n in names):
            return top
    raise PackError("There is no pack.json in this zip file, so it is not a character pack.")


def install_zip(zip_path, bundled, yours):
    """Install a character pack from a zip file into the folder of packs the author has added. Everything is checked before anything is kept."""
    zip_path = pathlib.Path(zip_path)
    yours = pathlib.Path(yours)
    try:
        archive = zipfile.ZipFile(zip_path)
    except (zipfile.BadZipFile, OSError):
        raise PackError("That is not a zip file that can be opened.") from None
    with archive:
        infos = [i for i in archive.infolist() if not i.is_dir()]
        if len(infos) > MAX_FILES:
            raise PackError("That zip file holds far more files than a character pack does.")
        names = {i.filename for i in infos}
        top = _find_top(names)
        wanted = []
        for info in infos:
            if not _member_ok(info.filename, top):
                raise PackError(f"The zip file holds a file with a name that is not allowed: {info.filename[:80]}")
            if stat.S_ISLNK(info.external_attr >> 16):
                raise PackError("The zip file holds a link, which a pack may not.")
            rel = info.filename[len(top) + 1:] if top else info.filename
            lower = rel.lower()
            if "/" not in rel and lower in ("pack.json",):
                limit = MAX_TEXT_BYTES
            elif "/" not in rel and lower.endswith((".txt", ".md")):
                limit = MAX_TEXT_BYTES
            elif lower.endswith(PICTURE_TYPES):
                limit = MAX_PICTURE_BYTES
            else:
                raise PackError(f"A character pack holds only pictures, pack.json and plain text, and this zip file holds {rel[:80]}.")
            if info.file_size > limit:
                raise PackError(f"{rel} is larger than a file in a pack may be.")
            wanted.append((info, rel, limit))
        if sum(i.file_size for i, _, _ in wanted) > MAX_PACK_BYTES:
            raise PackError(f"The pack is larger than {MAX_PACK_BYTES // (1024 * 1024)} MB.")
        folded = [rel.lower() for _, rel, _ in wanted]
        if len(set(folded)) != len(folded):
            raise PackError("The zip file holds two files whose names differ only by capital letters.")
        yours.mkdir(parents=True, exist_ok=True)
        stage = yours / f".installing-{os.getpid()}"
        shutil.rmtree(stage, ignore_errors=True)
        stage.mkdir()
        try:
            kept = 0
            for info, rel, limit in wanted:
                target = stage / pathlib.PurePosixPath(rel)
                target.parent.mkdir(parents=True, exist_ok=True)
                written = 0
                try:
                    with archive.open(info) as source, open(target, "wb") as out:
                        while True:
                            block = source.read(64 * 1024)
                            if not block:
                                break
                            written += len(block)
                            kept += len(block)
                            if written > limit:
                                raise PackError(f"{rel} is larger than a file in a pack may be.")
                            if kept > MAX_PACK_BYTES:
                                raise PackError(f"The pack is larger than {MAX_PACK_BYTES // (1024 * 1024)} MB.")
                            out.write(block)
                except (zipfile.BadZipFile, NotImplementedError, RuntimeError, zlib.error):
                    raise PackError("That zip file is damaged, or is locked with a password, so it cannot be opened.") from None
            manifest = check_pack(stage)
            known = find_pack(manifest["id"], bundled, None)
            if known:
                raise PackError(f"A pack called \"{manifest['id']}\" already comes with OpenStage Author, so this one is not installed.")
            target = yours / manifest["id"]
            replaced = None
            if target.exists():
                try:
                    replaced = check_pack(target)["version"]
                except PackError:
                    replaced = "?"
                backup = yours / f".old-{manifest['id']}-{os.getpid()}"
                shutil.rmtree(backup, ignore_errors=True)
                os.replace(target, backup)
                try:
                    os.replace(stage, target)
                except OSError:
                    os.replace(backup, target)
                    raise
                shutil.rmtree(backup, ignore_errors=True)
            else:
                os.replace(stage, target)
        finally:
            shutil.rmtree(stage, ignore_errors=True)
    verb = "Updated" if replaced else "Installed"
    extra = f" (it was version {replaced})" if replaced and replaced != "?" else ""
    return {
        "ok": True, "id": manifest["id"], "title": manifest["title"], "version": manifest["version"], "replaced": bool(replaced),
        "message": f"{verb} the character pack \"{manifest['title']}\" version {manifest['version']}{extra}: {len(manifest['people'])} {'person' if len(manifest['people']) == 1 else 'people'}.",
    }


def remove_pack(pack_id, yours):
    """Take away a pack the author added. A pack that came with the program cannot be taken away."""
    if not isinstance(pack_id, str) or not PACK_ID.match(pack_id):
        raise PackError("That is not the name of a pack.")
    target = pathlib.Path(yours) / pack_id
    if not (target / "pack.json").is_file():
        raise PackError("That pack is not one you added, so it cannot be removed here.")
    last = None
    for _ in range(5):
        try:
            shutil.rmtree(target, onerror=_forget_read_only)
            last = None
            break
        except OSError as e:
            last = e
    if last is not None or target.exists():
        raise PackError("The pack could not be removed. Close anything that has its pictures open, then try again.")
    return {"ok": True, "message": "Removed the pack."}


def _forget_read_only(function, path, _info):
    os.chmod(path, stat.S_IWRITE)
    function(path)


# ---- command line

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("list", "install", "remove", "check"):
        s = sub.add_parser(name)
        if name == "install":
            s.add_argument("zip")
        if name == "remove":
            s.add_argument("id")
        if name == "check":
            s.add_argument("folder")
        else:
            s.add_argument("--yours", required=True)
        if name in ("list", "install"):
            s.add_argument("--bundled", default="")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        if args.command == "list":
            answer = list_packs(args.bundled, args.yours)
        elif args.command == "install":
            answer = install_zip(args.zip, args.bundled, args.yours)
        elif args.command == "remove":
            answer = remove_pack(args.id, args.yours)
        else:
            manifest = check_pack(args.folder)
            answer = {"ok": True, "message": f"The pack \"{manifest['title']}\" is good: {len(manifest['people'])} people, {manifest['bytes'] // 1024} KB."}
    except PackError as e:
        answer = {"ok": False, "message": str(e)}
    print(json.dumps(answer, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
