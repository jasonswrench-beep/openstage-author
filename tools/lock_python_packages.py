#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Writes a locked list of Python packages: every package at one exact version, each with the SHA-256 of the file pip is to fetch,
so that pip installs them with --require-hashes and refuses any file that differs.

  python tools/lock_python_packages.py --python PY --wants WANTS.txt --out LIST.txt [--find-links DIR] [--title "a line for the top" ...]

PY is the Python the list is for (the embeddable Python the installer carries, with pip put in it), so that pip picks the files and follows
the conditions in the packages' own lists for that Python and this computer, not for the Python running this script. WANTS.txt names what
is wanted, one requirement per line, as loosely or as exactly as it should be; pip works out the rest. Only built packages are taken
(--only-binary :all:). A file found in DIR (--find-links) is hashed from that copy; one fetched from an address is hashed as pip reports it,
and a package whose hash pip cannot report stops the list from being written.

Used to make tools/python-requirements.txt (the tools' Python), tools/narration-python-requirements.txt (pip for the narration voice's
Python) and tools/narration-requirements.txt (the narration voice). docs/narration-setup.md says when and how to run it again.
"""

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def resolve(python, wants, find_links=None):
    """What pip would install for `wants` with `python`, as its installation report's list of packages."""
    with tempfile.TemporaryDirectory(prefix="openstage-lock-") as scratch:
        report = Path(scratch, "report.json")
        args = [str(python), "-m", "pip", "install", "--dry-run", "--ignore-installed", "--quiet", "--disable-pip-version-check", "--no-cache-dir",
                "--only-binary", ":all:", "--target", str(Path(scratch, "target")), "--report", str(report), "-r", str(wants)]
        if find_links:
            args[4:4] = ["--find-links", str(find_links)]
        done = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if done.returncode != 0:
            raise SystemExit("pip could not work out the packages:\n" + done.stdout + done.stderr)
        return json.loads(report.read_text(encoding="utf-8"))["install"]


def locked_lines(packages):
    """One requirement line per package: name==version, or name @ address for one named by its address, with its hash."""
    lines = []
    for item in sorted(packages, key=lambda p: p["metadata"]["name"].lower()):
        name, version = item["metadata"]["name"], item["metadata"]["version"]
        info = item["download_info"]
        url = info["url"]
        if url.startswith("file:"):
            digest = sha256(Path(urllib.request.url2pathname(urllib.parse.urlparse(url).path)))
        else:
            hashes = info.get("archive_info", {}).get("hashes", {})
            digest = hashes.get("sha256")
            if not digest:
                raise SystemExit(f"pip reported no SHA-256 for {name} {version} ({url}); give its address with #sha256=... in the wants list.")
        if item.get("is_direct") and not url.startswith("file:"):
            lines.append(f"{name} @ {url.split('#', 1)[0]} --hash=sha256:{digest}")
        else:
            lines.append(f"{name}=={version} --hash=sha256:{digest}")
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--python", required=True)
    parser.add_argument("--wants", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--find-links")
    parser.add_argument("--title", action="append", default=[], help="a line for the top of the list (give it more than once for more lines)")
    a = parser.parse_args()
    packages = resolve(a.python, a.wants, a.find_links)
    version = subprocess.run([a.python, "-c", "import platform; print(platform.python_version())"], capture_output=True, text=True).stdout.strip()
    head = [f"# {line}" for line in a.title] + [
        f"# Locked for Python {version} on 64-bit Windows by tools/lock_python_packages.py from {Path(a.wants).name}. Do not edit by hand: change the wants and run it again.",
        "# Every line has the SHA-256 of the one file pip is to fetch for it, and pip is run with --require-hashes, so a file that differs is refused.",
    ]
    Path(a.out).write_text("\n".join(head + locked_lines(packages)) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(packages)} packages written to {a.out}")


if __name__ == "__main__":
    sys.exit(main())
