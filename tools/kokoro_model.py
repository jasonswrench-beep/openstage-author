#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Fetches the Kokoro voice model for the narration engine, exactly as tools/kokoro-model.json describes it, and checks every file.

  python tools/kokoro_model.py            fetch what is missing and check everything; exit 1 if anything does not match
  python tools/kokoro_model.py --check    only check what is already there, without the network

The editor runs it while it installs the narration voice (engine.rs), with the engine's packages on PYTHONPATH and HF_HOME set to the engine's
own folder. Only the one commit of the model's repository named in the list is fetched, so a later change to that repository never reaches an
author. Every file is compared with its size and SHA-256 in the list; one that does not match is deleted and the install stops. Then the cache
is told that this commit is the model's "main", the name Kokoro asks for, and the engine runs with HF_HUB_OFFLINE=1, so it never looks online
for a newer one.
"""

import hashlib
import json
import os
import sys
from pathlib import Path

LIST = Path(__file__).resolve().with_name("kokoro-model.json")


class ModelError(Exception):
    pass


def model_list(path=LIST):
    """The repository, the commit and the files, read from the list, with each entry checked for shape."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    revision = data.get("revision", "")
    if not (isinstance(revision, str) and len(revision) == 40 and all(c in "0123456789abcdef" for c in revision)):
        raise ModelError("The model list names no fixed commit.")
    files = data.get("files")
    if not isinstance(files, dict) or not files:
        raise ModelError("The model list names no files.")
    for rel, want in files.items():
        if ".." in rel.split("/") or rel.startswith("/") or "\\" in rel:
            raise ModelError(f"The model list names a file outside the model: {rel}")
        if not (isinstance(want.get("size"), int) and isinstance(want.get("sha256"), str) and len(want["sha256"]) == 64):
            raise ModelError(f"The model list has no size or SHA-256 for {rel}.")
    return data["repo"], revision, files


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def mismatches(snapshot, files):
    """The files under `snapshot` that are missing or differ from the list, each with what is wrong."""
    wrong = []
    for rel, want in sorted(files.items()):
        path = Path(snapshot, *rel.split("/"))
        if not path.is_file():
            wrong.append((rel, "missing"))
        elif path.stat().st_size != want["size"]:
            wrong.append((rel, f"{path.stat().st_size} bytes, not {want['size']}"))
        elif sha256(path) != want["sha256"]:
            wrong.append((rel, "its SHA-256 differs from the list"))
    return wrong


def remove(snapshot, rel):
    """Delete a file that did not match, and what it stands for in the cache (the snapshot entry may be a link to a stored copy)."""
    path = Path(snapshot, *rel.split("/"))
    try:
        target = path.resolve() if path.is_symlink() else None
        path.unlink(missing_ok=True)
        if target is not None:
            target.unlink(missing_ok=True)
    except OSError:
        pass


def point_main(snapshot, revision):
    """Record in the cache that the model's "main" is this commit: Kokoro asks for the model by that name, and offline the cache answers from this file."""
    snapshot = Path(snapshot)
    if snapshot.name != revision or snapshot.parent.name != "snapshots":
        raise ModelError(f"The model was not where it was expected: {snapshot}")
    refs = snapshot.parent.parent / "refs"
    refs.mkdir(parents=True, exist_ok=True)
    (refs / "main").write_text(revision, encoding="ascii")


def fetch(repo, revision, files):
    """Download the listed files of that commit (what is there already is kept) and return the snapshot folder."""
    os.environ.pop("HF_HUB_OFFLINE", None)  # the engine runs offline; fetching is the one thing that must not
    from huggingface_hub import snapshot_download

    return snapshot_download(repo, revision=revision, allow_patterns=sorted(files))


def cached_snapshot(repo, revision):
    os.environ["HF_HUB_OFFLINE"] = "1"
    from huggingface_hub import constants

    return Path(constants.HF_HUB_CACHE, "models--" + repo.replace("/", "--"), "snapshots", revision)


def main(argv):
    try:
        repo, revision, files = model_list()
        snapshot = cached_snapshot(repo, revision) if "--check" in argv else fetch(repo, revision, files)
        wrong = mismatches(snapshot, files)
        if wrong:
            if "--check" not in argv:
                for rel, _ in wrong:
                    remove(snapshot, rel)
            details = "; ".join(f"{rel}: {why}" for rel, why in wrong[:5])
            raise ModelError(f"{len(wrong)} of the voice model's files did not match the list, so they were not kept ({details}). Try again later; if it happens again, stop and report it.")
        point_main(snapshot, revision)
    except ModelError as e:
        print(str(e), file=sys.stderr, flush=True)
        return 1
    print(f"The voice model is here, and all {len(files)} of its files match the list.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
