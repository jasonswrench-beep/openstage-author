#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Builds the Windows installer for OpenStage Author (a single setup .exe).

  python tools/build_installer.py            the real installer, in dist/installer/
  python tools/build_installer.py --trial    a copy with its own name and identifier ("OpenStage Author Trial"), so installing it
                                             to try it touches none of the real program's settings, models or shortcuts
  python tools/build_installer.py --stage-only   only gather the files, into dist/installer-staging/payload (no installer)
  python tools/build_installer.py --version 0.1.1   a different version number, to try installing one version over another
  python tools/build_installer.py --sign     the same, signed and timestamped with Azure Artifact Signing (tools/sign_windows.py says what it needs);
                                             with --stage-only it signs the gathered files and stops
  python tools/build_installer.py --check-signatures SETUP.exe   only check a setup file that was built already: it and every program inside it

Signing (--sign): the programs in the payload that nobody has signed are signed first (the recorder, the speech recogniser, esbuild, a compiled
Python library), apart from the few left unsigned on purpose (LEAVE_UNSIGNED). Files their makers signed (Python, Node) keep those signatures. Tauri's
bundler then signs the editor program, its installer plugins, the uninstaller and the setup file through the same script, and the finished setup is
unpacked with 7-Zip and every program inside it checked. Its SHA-256 is worked out after all of that, so it is the hash of the signed file.

What goes into the installer is described in docs/decisions/0004-packaging-and-narration.md. In short: the editor program, the recorder, the speech
recogniser (built earlier by BUILD SPEECH RECOGNISER.bat), the course tools, the player, a copy of Python with jsonschema, a copy of Node, and the
licence texts. Nothing from the GPL family goes in: the narration engine is installed on the user's own computer, afterwards.

It downloads, once, into dist/installer-cache (checked against the sizes and checksums the publishers list, and kept for next time): the 64-bit
embeddable Python from python.org, Node from nodejs.org, and (through pip) jsonschema and what it needs. The first run of Tauri's bundler also
downloads the installer maker (NSIS) into its own cache. Needs Node, npm, Rust and Python on the computer that builds it, as building from source always has.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sign_windows  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
EDITOR = ROOT / "editor"
TAURI = EDITOR / "src-tauri"
DIST = ROOT / "dist"
CACHE = DIST / "installer-cache"
STAGING = DIST / "installer-staging"
PAYLOAD = STAGING / "payload"
OUT = DIST / "installer"

PYTHON_VERSION = "3.11.9"  # the version the checker, the migrations and Kokoro are known to work with (the last 3.11 that python.org built for Windows)
PYTHON_URL = f"https://www.python.org/ftp/python/{PYTHON_VERSION}/python-{PYTHON_VERSION}-embed-amd64.zip"
PYTHON_MD5 = "6d9aa08531d48fcc261ba667e2df17c4"  # as listed on https://www.python.org/downloads/release/python-3119/
NODE_VERSION = "24.21.0"  # the version on the main computer
NODE_URL = f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-win-x64.zip"
NODE_SUMS_URL = f"https://nodejs.org/dist/v{NODE_VERSION}/SHASUMS256.txt"
PIP_PACKAGES = ["jsonschema==4.26.0", "pip==26.2.1"]  # jsonschema is what tools/validate.py needs (pip adds attrs, referencing, rpds-py and jsonschema-specifications); pip is what installs the narration voice later

# Only these example courses go in (the others are test material).
EXAMPLES = ["minimal.osproj", "interactions.osproj", "question-types.osproj", "lesson-parts.osproj", "scenario.osproj", "timed-media.osproj", "looks.osproj", "branching.osproj",
            # Every ready-made game, finished, so there is something to play at once (Jason, 2026-11-10).
            "quiz-board.osproj", "prize-ladder.osproj", "escape-room.osproj", "order-challenge.osproj"]
TOOLS = ["validate.py", "migrate.py", "narrate.py", "narration_key.py", "quiztext.py", "generate.py", "voice_sample.py", "kokoro-voices.json", "openai-voices.json", "download-types.json", "theme-rules.json", "narration-requirements.txt", "docopt-0.6.2-py2.py3-none-any.whl", "charpack.py", "pngio.py", "xliff.py", "review_doc.py", "player-text.json"]
PLAYER_PACKAGES = [("esbuild",), ("@esbuild", "win32-x64"), ("fflate",)]
# The file the MCP server is shipped as, beside the player. The editor looks for it by this name.
MCP_SERVER = "openstage-mcp.mjs"
TRIAL = {"identifier": "com.openstageauthor.editor.trial", "productName": "OpenStage Author Trial"}

# The program name written into each signature (Windows shows it, for example, in a prompt that asks to run a signed program).
SIGN_DESCRIPTION = "OpenStage Author"
# Program files in the payload that stay unsigned on purpose, by their exact place in it. Anything else that nobody has signed is signed by --sign.
LEAVE_UNSIGNED = {
    # pip's launcher templates. pip copies one each time it installs a package that has commands of its own, and installing the narration voice does
    # (pip install --target with tools/narration-requirements.txt), so they must stay in the installer. What runs is pip's copy with a command added,
    # which would not carry a valid signature anyway, so they are not signed.
    "python/Lib/site-packages/pip/_vendor/distlib/t32.exe",
    "python/Lib/site-packages/pip/_vendor/distlib/t64.exe",
    "python/Lib/site-packages/pip/_vendor/distlib/t64-arm.exe",
    "python/Lib/site-packages/pip/_vendor/distlib/w32.exe",
    "python/Lib/site-packages/pip/_vendor/distlib/w64.exe",
    "python/Lib/site-packages/pip/_vendor/distlib/w64-arm.exe",
    # The wrappers pip made while this build installed jsonschema and pip. The program never runs them (it runs python -m pip). They may be left out
    # of the installer later, but only once installing the narration voice from an installer without them has been tried (Jason, 2026-11-11).
    "python/Lib/site-packages/bin/jsonschema.exe",
    "python/Lib/site-packages/bin/pip.exe",
    "python/Lib/site-packages/bin/pip3.exe",
    "python/Lib/site-packages/bin/pip3.11.exe",
}
SEVEN_ZIP = Path(os.environ.get("OPENSTAGE_7ZIP", r"C:\Program Files\7-Zip\7z.exe"))
LEAVE_LIST = DIST / "signing" / "leave-unsigned.txt"


def say(message=""):
    print(message, flush=True)


def fail(message):
    print("\nThe installer was not built: " + message, flush=True)
    sys.exit(1)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    say(f"  downloading {url}")
    request = urllib.request.Request(url, headers={"User-Agent": "OpenStageAuthor-installer-build"})
    with urllib.request.urlopen(request, timeout=120) as response, open(dest.with_suffix(dest.suffix + ".part"), "wb") as out:
        shutil.copyfileobj(response, out)
    dest.with_suffix(dest.suffix + ".part").replace(dest)


def cached_python():
    zip_path = CACHE / f"python-{PYTHON_VERSION}-embed-amd64.zip"
    if not zip_path.is_file():
        fetch(PYTHON_URL, zip_path)
    if md5(zip_path) != PYTHON_MD5:
        zip_path.unlink()
        fail(f"the Python download did not match the checksum python.org lists ({PYTHON_MD5}). It was deleted; run this again, and if it happens again, stop and look.")
    return zip_path


def cached_node():
    zip_path = CACHE / f"node-v{NODE_VERSION}-win-x64.zip"
    sums = CACHE / f"node-v{NODE_VERSION}-SHASUMS256.txt"
    if not sums.is_file():
        fetch(NODE_SUMS_URL, sums)
    wanted = None
    for line in sums.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1] == zip_path.name:
            wanted = parts[0]
    if wanted is None:
        fail(f"nodejs.org's list of checksums has no entry for {zip_path.name}.")
    if not zip_path.is_file():
        fetch(NODE_URL, zip_path)
    if sha256(zip_path) != wanted:
        zip_path.unlink()
        fail("the Node download did not match the checksum nodejs.org lists. It was deleted; run this again, and if it happens again, stop and look.")
    return zip_path


def copy_tree(src, dst, skip=()):
    def ignore(_dir, names):
        return [n for n in names if n in ("__pycache__", ".cache", "node_modules") or n.endswith(".pyc") or any(n == s for s in skip)]
    shutil.copytree(src, dst, ignore=ignore)


def stage():
    say("Gathering the files...")
    if STAGING.exists():
        shutil.rmtree(STAGING)
    PAYLOAD.mkdir(parents=True)

    # The recorder and the speech recogniser were built earlier; they are not rebuilt here.
    capture = ROOT / "capture" / "target" / "release" / "openstage-capture.exe"
    if not capture.is_file():
        fail("the recorder is not built. Run OPEN EDITOR.bat once, which builds it.")
    shutil.copy2(capture, PAYLOAD / "openstage-capture.exe")
    speech = ROOT / "speech"
    if not (speech / "whisper-cli.exe").is_file():
        fail("the speech recogniser is not built. Run BUILD SPEECH RECOGNISER.bat first.")
    (PAYLOAD / "speech").mkdir()
    for f in speech.iterdir():
        if f.is_file() and (f.suffix.lower() in (".exe", ".dll") or f.name.lower().endswith("-license.txt")):
            shutil.copy2(f, PAYLOAD / "speech" / f.name)

    # The course tools, the course format and the themes.
    (PAYLOAD / "tools").mkdir()
    for name in TOOLS:
        shutil.copy2(ROOT / "tools" / name, PAYLOAD / "tools" / name)
    copy_tree(ROOT / "tools" / "engines", PAYLOAD / "tools" / "engines")
    for folder in ("schema", "themes", "third-party"):
        copy_tree(ROOT / folder, PAYLOAD / folder)
    # The character packs that come with the program (the editor finds them by the README.txt in this folder).
    copy_tree(ROOT / "character-packs", PAYLOAD / "character-packs")
    (PAYLOAD / "examples").mkdir()
    for name in EXAMPLES:
        if (ROOT / "examples" / name).is_dir():
            copy_tree(ROOT / "examples" / name, PAYLOAD / "examples" / name)

    # The player and the publishing tool: its source (without its tests) and only the packages publishing uses.
    player = PAYLOAD / "player"
    (player / "src").mkdir(parents=True)
    for f in (ROOT / "player" / "src").iterdir():
        if f.is_file() and not f.name.endswith(".test.ts"):
            shutil.copy2(f, player / "src" / f.name)
    for name in ("publish.ts", "package.json", "tsconfig.json", "scorm-test.html"):
        if (ROOT / "player" / name).is_file():
            shutil.copy2(ROOT / "player" / name, player / name)
    for package in PLAYER_PACKAGES:
        source = ROOT / "player" / "node_modules" / Path(*package)
        if not source.is_dir():
            fail(f"the player's package {'/'.join(package)} is not installed. Run npm install in the player folder.")
        copy_tree(source, player / "node_modules" / Path(*package))

    # The MCP server, for AI assistants: one file made from the server and the editor code it uses, which runs with the Node that comes with the program.
    # The editor finds it by this name (mcp_script in lib.rs) and shows the lines that connect an assistant to it.
    say("  MCP server")
    done = subprocess.run(["node", "build.mjs"], cwd=ROOT / "mcp")
    built = ROOT / "mcp" / "dist" / MCP_SERVER
    if done.returncode != 0 or not built.is_file():
        fail("the MCP server did not build.")
    (PAYLOAD / "mcp").mkdir()
    shutil.copy2(built, PAYLOAD / "mcp" / MCP_SERVER)

    for name in ("LICENSE", "NOTICE"):
        shutil.copy2(ROOT / name, PAYLOAD / name)

    # Python, with jsonschema.
    say("  Python")
    py = PAYLOAD / "python"
    with zipfile.ZipFile(cached_python()) as z:
        z.extractall(py)
    pth = list(py.glob("python*._pth"))
    for p in pth:
        p.unlink()  # without it Python looks beside the script and honours PYTHONPATH, as an ordinary Python does
    site = py / "Lib" / "site-packages"
    site.mkdir(parents=True)
    pip = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet", "--no-warn-script-location", "--disable-pip-version-check", "--only-binary=:all:",
         "--platform", "win_amd64", "--python-version", "3.11", "--implementation", "cp", "--target", str(site), *PIP_PACKAGES],
        capture_output=True, text=True, encoding="utf-8",
    )
    if pip.returncode != 0:
        fail("pip could not fetch the Python packages:\n" + pip.stdout + pip.stderr)
    for cache in site.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)

    # Node.
    say("  Node")
    node = PAYLOAD / "node"
    node.mkdir()
    with zipfile.ZipFile(cached_node()) as z:
        for name in z.namelist():
            base = name.split("/", 1)[-1]
            if base in ("node.exe", "LICENSE"):
                with z.open(name) as src, open(node / base, "wb") as dst:
                    shutil.copyfileobj(src, dst)
    if not (node / "node.exe").is_file():
        fail("node.exe was not found in the Node download.")

    # The guides the program points to ("see docs/narration-setup.md"), without the internal notes.
    copy_tree(ROOT / "docs", PAYLOAD / "docs", skip=("handoff", "capture"))
    for name in ("START-HERE.md", "README.md"):
        shutil.copy2(ROOT / name, PAYLOAD / name)

    # The programs must not need Microsoft's Visual C++ runtime, which a computer that has only had Windows installed may lack (the Python carries its own copy of the two files it needs).
    checked = [PAYLOAD / "openstage-capture.exe", PAYLOAD / "node" / "node.exe", *sorted((PAYLOAD / "speech").glob("*.exe")), *sorted((PAYLOAD / "speech").glob("*.dll"))]
    done = subprocess.run([sys.executable, str(ROOT / "tools" / "check_imports.py"), *map(str, checked)], capture_output=True, text=True, encoding="utf-8")
    if done.returncode != 0:
        fail("a program asks for Microsoft's Visual C++ runtime:" + chr(10) + done.stdout + done.stderr)

    # Licences and the lists of what is inside, written last so they include the Python packages that were just put in.
    say("  writing the licence texts")
    done = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "check_licences.py"), "--write", "--texts", "--python", str(site), "--out", str(PAYLOAD)],
        capture_output=True, text=True, encoding="utf-8",
    )
    if done.returncode != 0:
        fail("the licence check failed:\n" + done.stdout + done.stderr)
    say("  " + done.stdout.splitlines()[0])

    total = sum(f.stat().st_size for f in PAYLOAD.rglob("*") if f.is_file())
    say(f"  {sum(1 for f in PAYLOAD.rglob('*') if f.is_file())} files, {total // (1024 * 1024)} MB before compression")


def resources():
    """The bundle's resource list: the whole payload folder, landing beside the program with its folders as they are."""
    return {os.path.relpath(PAYLOAD, TAURI).replace("\\", "/") + "/": ""}


def program_files(folder):
    """Every Windows program file under a folder: programs and the libraries they load (a .pyd is a library for Python)."""
    return sorted(p for p in Path(folder).rglob("*") if p.is_file() and p.suffix.lower() in sign_windows.PROGRAM_FILES)


def left_unsigned_on_purpose(place):
    """Whether a file's place (in the payload, or in the unpacked installer, where it may sit one folder deeper) is one of LEAVE_UNSIGNED."""
    place = place.replace("\\", "/")
    return any(place == kept or place.endswith("/" + kept) for kept in LEAVE_UNSIGNED)


def sign_payload():
    """Signs every program file in the payload that nobody has signed, apart from LEAVE_UNSIGNED. Files their makers signed are left as they are."""
    say("Signing the programs in the payload...")
    files = program_files(PAYLOAD)
    places = {str(f.resolve()): f.relative_to(PAYLOAD).as_posix() for f in files}
    gone = sorted(kept for kept in LEAVE_UNSIGNED if not (PAYLOAD / kept).is_file())
    if gone:
        fail("the list of files left unsigned on purpose (LEAVE_UNSIGNED) names files that are not in the payload any more: " + ", ".join(gone) +
             ". Look at what took their place, and update the list.")
    try:
        found = sign_windows.signatures(files)
    except sign_windows.SignError as e:
        fail(str(e))
    unsigned = [Path(info["path"]) for info in found if info["status"] != "Valid" and not left_unsigned_on_purpose(places[info["path"]])]
    makers = [info for info in found if info["status"] == "Valid"]
    say(f"  {len(files)} program files: {len(makers)} signed by their makers, {len(LEAVE_UNSIGNED)} left unsigned on purpose, {len(unsigned)} to sign")
    try:
        signtool, dlib, metadata = sign_windows.find_signtool(), sign_windows.find_dlib(), sign_windows.write_metadata()
        publisher = os.environ.get("OPENSTAGE_SIGN_PUBLISHER") or None
        for f in unsigned:
            say(f"  {places[str(f)]}: " + sign_windows.sign_one(f, signtool, dlib, metadata, SIGN_DESCRIPTION, publisher))
    except sign_windows.SignError as e:
        fail(str(e))


def installer_config(trial, version=None, sign=False):
    """The Tauri configuration the installer is built with: the installer settings, the payload, and (when signing) the command that signs."""
    base = json.loads((TAURI / "tauri.installer.conf.json").read_text(encoding="utf-8"))
    base["bundle"]["resources"] = resources()
    if trial:
        base.update(TRIAL)
    if version:
        base["version"] = version
    if sign:
        # The object form, so a space in a path or in the description cannot split an argument. Tauri puts the file's path in place of %1.
        # Tauri offers every unsigned program among the bundled files, pip's launchers too: the list makes the script decline LEAVE_UNSIGNED.
        base["bundle"]["windows"]["signCommand"] = {"cmd": sys.executable, "args": [
            str(ROOT / "tools" / "sign_windows.py"), "--description", SIGN_DESCRIPTION, "--leave-list", str(LEAVE_LIST), "%1"]}
    return base


def write_leave_list():
    """The list sign_windows.py reads (--leave-list): one place per line."""
    LEAVE_LIST.parent.mkdir(parents=True, exist_ok=True)
    LEAVE_LIST.write_text("# Left unsigned on purpose (LEAVE_UNSIGNED in tools/build_installer.py)\n" + "\n".join(sorted(LEAVE_UNSIGNED)) + "\n", encoding="utf-8")


def check_installer(setup):
    """Checks a setup file and every program inside it (unpacked with 7-Zip into a temporary folder). Returns the problems, in words; none means it passed.

    "Ours" means signed by OPENSTAGE_SIGN_PUBLISHER, or, when that is not set, by whoever signed the setup file itself. Ours must be signed and
    timestamped; a file its maker signed (Python, Node, Microsoft) must have a valid signature and is otherwise not ours to change; LEAVE_UNSIGNED may
    stay unsigned. The uninstaller is only written out when the program is installed, so it may not be among the unpacked files: it is then checked
    after a trial install."""
    setup = Path(setup).resolve()
    if not SEVEN_ZIP.is_file():
        return [f"7-Zip is not at {SEVEN_ZIP}, so the programs inside the setup cannot be checked (set OPENSTAGE_7ZIP)."]
    problems = []
    with tempfile.TemporaryDirectory(prefix="openstage-signcheck-") as unpacked:
        unpacked = Path(unpacked).resolve()
        done = subprocess.run([str(SEVEN_ZIP), "x", "-y", f"-o{unpacked}", str(setup)], capture_output=True, text=True, encoding="utf-8", errors="replace")
        if done.returncode != 0:
            return ["7-Zip could not unpack the setup:\n" + done.stdout + done.stderr]
        inside = program_files(unpacked)
        try:
            found = sign_windows.signatures([setup, *inside])
        except sign_windows.SignError as e:
            return [str(e)]
        publisher = os.environ.get("OPENSTAGE_SIGN_PUBLISHER") or found[0]["signer"]
        why = sign_windows.problem(found[0], publisher)
        if why:
            problems.append(f"the setup file: {why}")
        ours, makers, kept = 0, {}, []
        for info in found[1:]:
            place = Path(info["path"]).relative_to(unpacked).as_posix()
            if left_unsigned_on_purpose(place):
                kept.append(place)
                if info["status"] == "Valid":
                    problems.append(f"{place}: meant to stay unsigned (LEAVE_UNSIGNED), but it was signed")
                continue
            if info["status"] == "Valid" and info["signer"] != publisher:
                makers[info["signer"]] = makers.get(info["signer"], 0) + 1
                continue
            why = sign_windows.problem(info, publisher)
            if why:
                problems.append(f"{place}: {why}")
            else:
                ours += 1
        uninstaller = any(p.name.lower().startswith("uninstall") for p in inside)
        say(f"Checked the setup file and the {len(inside)} program files inside it. Signer of the setup: {found[0]['signer'] or 'nobody'}.")
        say(f"  {ours} inside signed and timestamped by {publisher or 'nobody'}; " + "".join(f"{n} by {name}; " for name, n in sorted(makers.items())) +
            f"{len(kept)} left unsigned on purpose")
        if not uninstaller:
            say("  The uninstaller is not among the unpacked files (it is written out when the program is installed): check it after a trial install.")
    return problems


def build(trial, version=None, sign=False):
    say("Building the installer (the first time, Tauri downloads its installer maker)...")
    base = installer_config(trial, version, sign)
    if sign:
        write_leave_list()
    config = STAGING / "tauri.build.conf.json"
    config.write_text(json.dumps(base, indent=2), encoding="utf-8")
    say("  web side")
    done = subprocess.run(["node", "build.mjs"], cwd=EDITOR)
    if done.returncode != 0:
        fail("the editor's web side did not build.")
    npx = "npx.cmd" if os.name == "nt" else "npx"
    done = subprocess.run([npx, "tauri", "build", "--bundles", "nsis", "--config", str(config)], cwd=EDITOR)
    if done.returncode != 0:
        fail("Tauri could not build the installer. Scroll up to see why.")
    found = sorted((TAURI / "target" / "release" / "bundle" / "nsis").glob("*-setup.exe"), key=lambda p: p.stat().st_mtime)
    if not found:
        fail("the installer maker finished, but no setup file was made.")
    done = subprocess.run([sys.executable, str(ROOT / "tools" / "check_imports.py"), str(TAURI / "target" / "release" / "openstage-editor.exe")], capture_output=True, text=True, encoding="utf-8")
    if done.returncode != 0:
        fail("the editor program asks for Microsoft's Visual C++ runtime:" + chr(10) + done.stdout + done.stderr)
    if sign:
        problems = check_installer(found[-1])
        if problems:
            fail("the setup was built, but these are not signed as they should be:\n  " + "\n  ".join(problems))
    OUT.mkdir(parents=True, exist_ok=True)
    result = OUT / (found[-1].name if not trial else found[-1].name.replace("-setup", "-trial-setup"))
    shutil.copy2(found[-1], result)
    (OUT / (result.name + ".sha256")).write_text(f"{sha256(result)}  {result.name}\n", encoding="utf-8")
    say(f"\nBuilt {result} ({result.stat().st_size // (1024 * 1024)} MB)")
    say(f"SHA-256: {sha256(result)}")
    return result


def main():
    if "--check-signatures" in sys.argv:
        at = sys.argv.index("--check-signatures")
        if at + 1 >= len(sys.argv) or not Path(sys.argv[at + 1]).is_file():
            fail("--check-signatures needs the setup file after it.")
        problems = check_installer(sys.argv[at + 1])
        for p in problems:
            say("  " + p)
        say("Every file that should be signed is signed and timestamped." if not problems else f"{len(problems)} problems.")
        return 1 if problems else 0
    trial = "--trial" in sys.argv
    version = sys.argv[sys.argv.index("--version") + 1] if "--version" in sys.argv else None
    sign = "--sign" in sys.argv
    if sign:
        # Before the long build: everything signing needs must be here (it asks Azure nothing yet).
        ok, lines = sign_windows.ready()
        if not ok:
            fail("signing cannot start:\n" + "\n".join(lines))
    stage()
    if sign:
        sign_payload()
    if "--stage-only" in sys.argv:
        say(f"\nThe files are in {PAYLOAD}")
        return 0
    build(trial, version, sign)
    return 0


if __name__ == "__main__":
    sys.exit(main())
