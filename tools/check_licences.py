#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Checks the licences of what the OpenStage Author editor program is built from, and writes the list.

The editor program (editor/src-tauri) is built from Rust crates; its web side and the publishing tools use a few JavaScript
packages. This checks each against the rule in CLAUDE.md (permissive licences only; a copyleft licence is a hard stop) and fails
when something new appears that nobody has looked at. OpenStage Capture has its own checker (capture/tools/check_rules.py).

  python tools/check_licences.py              check, and say what was found
  python tools/check_licences.py --write      also write editor/THIRD-PARTY.md (the list that NOTICE points to)
  python tools/check_licences.py --texts      also write editor/THIRD-PARTY-LICENSES.txt: the licence texts of every crate and
                                              package, which an installer must carry (ignored by git: made when a package is built)
  --python <site-packages>                    also check (and list) the Python packages in that folder, as the installer's own Python has them
  --out <folder>                              write the list and the texts there instead of into editor/ (the installer build does, so what it carries includes the Python packages)

The one licence on the list that is not simply permissive is MPL-2.0, which applies file by file. Five crates that come with Tauri's
web view layer use it (see MPL_OK). They are used as published, unmodified. A sixth would fail the check until someone has looked.

Needs `cargo` (offline: it reads the crates already downloaded) and the packages already installed by `npm install`.
Exit code: 0 if every check passes, 1 if any fails, 2 if a tool needed for the check is not there.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAURI = ROOT / "editor" / "src-tauri"
OUT_LIST = ROOT / "editor" / "THIRD-PARTY.md"
OUT_TEXTS = ROOT / "editor" / "THIRD-PARTY-LICENSES.txt"

# Licences that can be shipped inside an Apache-2.0 project (the same list as capture/tools/check_rules.py).
ALLOWED = {
    "Apache-2.0", "MIT", "MIT-0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unlicense", "CC0-1.0",
    "0BSD", "BSL-1.0", "Unicode-3.0", "Unicode-DFS-2016", "CDLA-Permissive-2.0",
}

# Weak, file-level copyleft that has been looked at. Each is used unmodified, so only its own files are covered; a licence text and
# a pointer to the source (crates.io) go with a program that includes it. Adding a crate here is a decision for the owner.
MPL_OK = {"cssparser", "cssparser-macros", "dtoa-short", "option-ext", "selectors"}

# Python packages carry their licence in their metadata, either as an expression or as a classifier.
CLASSIFIERS = {
    "MIT License": "MIT", "Apache Software License": "Apache-2.0", "BSD License": "BSD-3-Clause", "ISC License (ISCL)": "ISC",
    "Python Software Foundation License": "PSF-2.0", "The Unlicense (Unlicense)": "Unlicense", "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
}
ALLOWED.add("PSF-2.0")
# pip carries certifi (the list of trusted web sites' certificate makers, under MPL-2.0 file by file); it is not changed.
PY_MPL_OK = {"certifi"}

TARGET = "x86_64-pc-windows-msvc"

# Packages the web side and the publishing tools carry (not the build tools such as TypeScript, which are not shipped).
JS_ROOTS = [
    (ROOT / "editor", ["@tauri-apps/api", "@tauri-apps/plugin-dialog", "@tauri-apps/plugin-opener"], "the editor's web side"),
    (ROOT / "player", ["fflate", "esbuild", "@esbuild/win32-x64"], "the publishing tools"),
]


# ---- licence expressions: "MIT OR Apache-2.0", "(A OR B) AND C", "Apache-2.0 WITH LLVM-exception", "MIT/Apache-2.0"

def tokens(expr):
    return re.findall(r"\(|\)|[A-Za-z0-9.+\-]+", expr.replace("/", " OR "))


def acceptable(expr, name=""):
    """Whether an expression can be satisfied with allowed licences alone. OR needs one side, AND needs both, WITH is ignored.
    MPL-2.0 counts as allowed only for a crate on the MPL_OK list. An empty or unknown expression is not acceptable."""
    toks = tokens(expr or "")
    pos = 0

    def atom():
        nonlocal pos
        if pos >= len(toks):
            return False
        t = toks[pos]
        if t == "(":
            pos += 1
            v = orexpr()
            if pos < len(toks) and toks[pos] == ")":
                pos += 1
            return v
        pos += 1
        if pos < len(toks) and toks[pos].upper() == "WITH":
            pos += 2
        if t == "MPL-2.0":
            return name in MPL_OK
        return t in ALLOWED

    def andexpr():
        nonlocal pos
        v = atom()
        while pos < len(toks) and toks[pos].upper() == "AND":
            pos += 1
            v = atom() and v
        return v

    def orexpr():
        nonlocal pos
        v = andexpr()
        while pos < len(toks) and toks[pos].upper() == "OR":
            pos += 1
            v = andexpr() or v
        return v

    return bool(toks) and orexpr() and pos == len(toks)


# ---- what is built into the editor program

def rust_crates():
    try:
        done = subprocess.run(
            ["cargo", "metadata", "--offline", "--format-version", "1", "--filter-platform", TARGET],
            cwd=TAURI, capture_output=True, text=True, encoding="utf-8",
        )
    except FileNotFoundError:
        print("cargo was not found, so the Rust crates cannot be checked.")
        sys.exit(2)
    if done.returncode != 0:
        print("cargo could not read the crates:", (done.stderr or "").strip().splitlines()[-1:] or "")
        sys.exit(2)
    meta = json.loads(done.stdout)
    packages = {p["id"]: p for p in meta["packages"]}
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    root = meta["resolve"]["root"]
    seen, stack = set(), [root]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        for dep in nodes[current]["deps"]:
            if any(k["kind"] is None for k in dep["dep_kinds"]):  # a normal dependency, not one for tests or the build
                stack.append(dep["pkg"])
    found = []
    for pid in seen:
        p = packages[pid]
        if pid == root:
            continue
        found.append({"name": p["name"], "version": p["version"], "license": p.get("license") or "", "dir": Path(p["manifest_path"]).parent})
    return sorted(found, key=lambda c: (c["name"], c["version"]))


def python_packages(site):
    """The Python packages installed in a folder (from their *.dist-info), with their licence as the package says it."""
    import email.parser
    found = []
    for info in sorted(Path(site).glob("*.dist-info")):
        meta_file = info / "METADATA"
        if not meta_file.is_file():
            continue
        meta = email.parser.Parser().parsestr(meta_file.read_text(encoding="utf-8", errors="replace"))
        expression = (meta.get("License-Expression") or "").strip()
        classifiers = [CLASSIFIERS[c.split("::")[-1].strip()] for c in meta.get_all("Classifier") or [] if c.startswith("License") and c.split("::")[-1].strip() in CLASSIFIERS]
        short = (meta.get("License") or "").strip()
        licence = expression or (" OR ".join(dict.fromkeys(classifiers)) if classifiers else (short if len(short) < 60 else ""))
        found.append({"name": meta.get("Name", info.name), "version": meta.get("Version", ""), "license": licence, "dir": info, "what": "the installer's Python"})
    return found


def js_packages():
    found, missing = [], []
    for base, names, what in JS_ROOTS:
        for name in names:
            path = base / "node_modules" / name / "package.json"
            if not path.is_file():
                missing.append(f"{name} (run npm install in {base.name})")
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            lic = data.get("license") or ""
            if isinstance(lic, dict):
                lic = lic.get("type", "")
            found.append({"name": name, "version": data.get("version", ""), "license": lic, "dir": path.parent, "what": what})
    return found, missing


# ---- the checks and the output

def check(rust, js, python=()):
    problems = []
    for c in list(rust) + list(js) + list(python):
        if c in python and c["license"] == "MPL-2.0" and c["name"].lower() in PY_MPL_OK:
            continue
        if not acceptable(c["license"], c["name"]):
            what = c["license"] or "no licence stated"
            problems.append(f"{c['name']} {c['version']}: {what}")
    return problems


def write_list(rust, js, python=(), out=None):
    mpl = [c for c in rust if "MPL-2.0" in c["license"]]
    lines = [
        "# Third-party components of the editor program",
        "",
        "Generated by `python tools/check_licences.py --write`. Do not edit by hand.",
        "",
        f"OpenStage Author is Apache-2.0. The editor program is built from these {len(rust)} Rust crates, each under the licence shown, and its web side and the",
        "publishing tools use the JavaScript packages below. OpenStage Capture (the recorder) lists its own crates in `capture/THIRD-PARTY.md`.",
        "The licence texts are collected by `python tools/check_licences.py --texts` for a package that is given to other people.",
        "",
        "Every licence here is permissive except MPL-2.0, which covers only the files of the crates that carry it. The "
        f"{len(mpl)} crates under it ({', '.join(c['name'] for c in mpl)}) come with Tauri's web view layer and are used as published, unmodified; their source is on crates.io and at the addresses in their own manifests.",
        "",
        "## JavaScript packages",
        "",
        "| Package | Version | Licence | Used by |",
        "|---|---|---|---|",
    ]
    for c in js:
        lines.append(f"| {c['name']} | {c['version']} | {c['license']} | {c['what']} |")
    if python:
        lines += ["", "## Python packages (the Python that travels with the installer)", "", "| Package | Version | Licence |", "|---|---|---|"]
        for c in python:
            lines.append(f"| {c['name']} | {c['version']} | {c['license'] or 'see its licence file'} |")
        lines += ["", "pip carries certifi, whose list of certificate makers is under MPL-2.0 (file by file; unchanged).", "Python itself is under the Python Software Foundation licence (python/LICENSE.txt); Node is under the MIT licence with the licences of what it contains (node/LICENSE)."]
    lines += ["", "## Rust crates", "", "| Crate | Version | Licence |", "|---|---|---|"]
    for c in rust:
        lines.append(f"| {c['name']} | {c['version']} | {c['license']} |")
    target = (Path(out) / "THIRD-PARTY.md") if out else OUT_LIST
    target.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {target.relative_to(ROOT) if ROOT in target.parents else target}")


LICENCE_FILE = re.compile(r"^(LICEN[CS]E|COPYING|UNLICENSE|NOTICE)", re.IGNORECASE)


def write_texts(rust, js, python=(), out=None):
    blocks = {}
    for c in list(rust) + list(js) + list(python):
        if c["dir"].is_dir() and c["dir"].name.endswith(".dist-info"):
            files = sorted(f for f in c["dir"].rglob("*") if f.is_file() and LICENCE_FILE.match(f.name))
        else:
            files = sorted(f for f in c["dir"].iterdir() if f.is_file() and LICENCE_FILE.match(f.name)) if c["dir"].is_dir() else []
        if not files:
            blocks.setdefault(f"(no licence file was found in the package; its manifest says {c['license']})", []).append(f"{c['name']} {c['version']}")
            continue
        for f in files:
            text = f.read_text(encoding="utf-8", errors="replace").strip()
            blocks.setdefault(text, []).append(f"{c['name']} {c['version']}")
    parts = ["Licences of the components of OpenStage Author's editor program and publishing tools.", "OpenStage Author itself is under the Apache License 2.0 (see LICENSE).", ""]
    for text, users in sorted(blocks.items(), key=lambda kv: kv[1][0]):
        parts += ["=" * 78, "Used by: " + ", ".join(sorted(set(users))), "=" * 78, text, ""]
    target = (Path(out) / "THIRD-PARTY-LICENSES.txt") if out else OUT_TEXTS
    target.write_text("\n".join(parts), encoding="utf-8", newline="\n")
    print(f"Wrote {target.relative_to(ROOT) if ROOT in target.parents else target} ({target.stat().st_size // 1024} KB, {len(blocks)} different texts)")


def option(name):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else None


def main():
    rust = rust_crates()
    js, missing = js_packages()
    site = option("--python")
    python = python_packages(site) if site else []
    out = option("--out")
    problems = check(rust, js, python)
    print(f"{len(rust)} Rust crates, {len(js)} JavaScript packages" + (f" and {len(python)} Python packages" if site else "") + " checked.")
    for m in missing:
        print("Not installed, so not checked:", m)
    if problems:
        print("These are not on the list of licences that can be shipped:")
        for p in problems:
            print("  ", p)
        print("Look at each one before it goes in; see CLAUDE.md, Licensing.")
    else:
        mpl = sorted({c["name"] for c in rust if "MPL-2.0" in c["license"]})
        print("All are permissive" + (f", except the MPL-2.0 crates that have been looked at: {', '.join(mpl)}." if mpl else "."))
    if "--write" in sys.argv:
        write_list(rust, js, python, out)
    if "--texts" in sys.argv:
        write_texts(rust, js, python, out)
    return 1 if problems or missing else 0


if __name__ == "__main__":
    sys.exit(main())
