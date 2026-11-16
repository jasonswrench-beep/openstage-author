#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Checks the rules of the OpenStage Presenter add-on on every change (CLAUDE.md, "Licensing" and "Screen capture" apply to it as to Capture).

It fails if:
  * a dependency has a license that is not on the allowed list (no GPL, no unknown licenses);
  * a dependency looks like FFmpeg (FFmpeg is not used);
  * any build file or script asks for an FFmpeg build with --enable-gpl or --enable-nonfree;
  * a source file is missing its Apache-2.0 license header;
  * project prose or comments contain an em dash.

Run it from anywhere:   python tools/check_rules.py
Exit code: 0 if every check passes, 1 if any fails.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # the presenter/ folder
REPO = ROOT.parent

ALLOWED = {
    "Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unlicense", "CC0-1.0",
    "0BSD", "BSL-1.0", "Unicode-3.0", "Unicode-DFS-2016",
}

SKIP_DIRS = {"target", ".git", "node_modules"}
HEADER_SUFFIXES = {".rs", ".py"}
FLAG_SUFFIXES = {".toml", ".rs", ".bat", ".cmd", ".sh", ".yml", ".yaml", ".py", ".lock"}
STYLE_SUFFIXES = {".md", ".rs", ".bat", ".py", ".toml", ".json"}
EM_DASH = chr(0x2014)  # built from its code so this file does not trip its own check

results = []


def record(status, name, detail=""):
    results.append((status, name, detail))


def files(base, suffixes):
    for path in sorted(base.rglob("*")):
        if path.is_file() and path.suffix in suffixes and not (set(path.parts) & SKIP_DIRS):
            yield path


# ---- license expressions: "MIT OR Apache-2.0", "(A OR B) AND C", "Apache-2.0 WITH LLVM-exception"

def tokenize(expr):
    return re.findall(r"\(|\)|[A-Za-z0-9.+\-]+", expr.replace("/", " OR "))


def license_ok(expr):
    tokens = tokenize(expr)
    pos = 0

    def parse_or():
        nonlocal pos
        value = parse_and()
        while pos < len(tokens) and tokens[pos] == "OR":
            pos += 1
            other = parse_and()
            value = value or other
        return value

    def parse_and():
        nonlocal pos
        value = parse_atom()
        while pos < len(tokens) and tokens[pos] == "AND":
            pos += 1
            other = parse_atom()
            value = value and other
        return value

    def parse_atom():
        nonlocal pos
        if pos >= len(tokens):
            return False
        token = tokens[pos]
        pos += 1
        if token == "(":
            value = parse_or()
            if pos < len(tokens) and tokens[pos] == ")":
                pos += 1
            return value
        ok = token.rstrip("+") in ALLOWED
        if pos < len(tokens) and tokens[pos] == "WITH":
            pos += 2  # an exception such as LLVM-exception only loosens a license
        return ok

    return parse_or()


def cargo_packages():
    out = subprocess.run(
        ["cargo", "metadata", "--format-version", "1", "--manifest-path", str(ROOT / "Cargo.toml")],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        record("FAIL", "read the dependency list", out.stderr.strip()[-400:])
        return []
    return json.loads(out.stdout)["packages"]


def check_dependencies(packages):
    bad = []
    for pkg in packages:
        expr = pkg.get("license")
        if not expr:
            bad.append(f"{pkg['name']} {pkg['version']}: no license listed")
        elif not license_ok(expr):
            bad.append(f"{pkg['name']} {pkg['version']}: {expr}")
    if bad:
        record("FAIL", "dependency licenses", "not on the allowed list: " + "; ".join(bad))
    else:
        record("PASS", "dependency licenses", f"{len(packages)} packages, all on the allowed list")
    ffmpeg = [p["name"] for p in packages if "ffmpeg" in p["name"].lower()]
    if ffmpeg:
        record("FAIL", "no FFmpeg dependency", "FFmpeg is not used: " + ", ".join(ffmpeg))
    else:
        record("PASS", "no FFmpeg dependency")


def check_headers():
    missing = []
    for path in files(ROOT, HEADER_SUFFIXES):
        head = " ".join(path.read_text(encoding="utf-8").splitlines()[:5])
        if "SPDX-License-Identifier: Apache-2.0" not in head:
            missing.append(str(path.relative_to(REPO)))
    if missing:
        record("FAIL", "license headers", "missing SPDX header: " + ", ".join(missing))
    else:
        record("PASS", "license headers")


def check_ffmpeg_flags():
    this = Path(__file__).resolve()
    hard = []
    for path in files(ROOT, FLAG_SUFFIXES):
        if path.resolve() == this:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for flag in ("--enable-gpl", "--enable-nonfree"):
            if flag in text:
                hard.append(f"{path.relative_to(REPO)} uses {flag}")
    if hard:
        record("FAIL", "FFmpeg build flags", "; ".join(hard))
    else:
        record("PASS", "FFmpeg build flags", "no --enable-gpl or --enable-nonfree")


def check_style():
    found = []
    for path in files(ROOT, STYLE_SUFFIXES):
        if EM_DASH in path.read_text(encoding="utf-8", errors="replace"):
            found.append(str(path.relative_to(REPO)))
    for doc in ("docs/presenter.md", "docs/avatar-addon-spec.md"):
        path = REPO / doc
        if doc != "docs/avatar-addon-spec.md" and path.exists() and EM_DASH in path.read_text(encoding="utf-8"):
            found.append(doc)
    if found:
        record("FAIL", "writing style (no em dashes)", ", ".join(sorted(set(found))))
    else:
        record("PASS", "writing style (no em dashes)")


def main():
    packages = cargo_packages()
    if packages:
        check_dependencies(packages)
    check_headers()
    check_ffmpeg_flags()
    check_style()
    failed = 0
    for status, name, detail in results:
        print(f"{status:<5} {name}" + (f": {detail}" if detail else ""))
        failed += status == "FAIL"
    print()
    print("All rule checks passed." if not failed else f"{failed} rule check(s) FAILED.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
